// API service to communicate with Railway backend

export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '')

export interface OptionData {
  strike: number
  type: 'C' | 'P'
  expiration: string
  bid: number
  ask: number
  last: number
  volume: number
  openInterest: number
  impliedVolatility: number
  delta: number
  gamma: number
  theta: number
  vega: number
  rho?: number
}

export interface SnapshotData {
  snapshotId: number
  ticker: string
  timestamp: string
  spotPrice: number
  dataCount: number
  options: OptionData[]
}

export interface TimestampInfo {
  timestamp: string
  spotPrice: number
}

export interface ExpiryInfo {
  expiration: string
  optionCount: number
}

export interface StatsData {
  ticker: string
  snapshotCount: number
  oldestSnapshot: string
  newestSnapshot: string
  averageOptionsPerSnapshot: number
}

/**
 * Health check - verify backend is running
 */
export async function checkHealth(): Promise<{ status: string; timestamp: string; uptime: number }> {
  try {
    const response = await fetch(`${BACKEND_URL}/health`)
    if (!response.ok) throw new Error('Health check failed')
    return await response.json()
  } catch (error) {
    console.error('Backend health check failed:', error)
    throw error
  }
}

/**
 * Get current latest snapshot for a ticker
 */
export async function getCurrentData(ticker: string): Promise<SnapshotData> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/current-data?ticker=${ticker}`)
    if (!response.ok) throw new Error(`Failed to fetch current data for ${ticker}`)
    const data = await response.json()
    return data.data
  } catch (error) {
    console.error(`Error fetching current data for ${ticker}:`, error)
    throw error
  }
}

/**
 * Get historical snapshot at specific timestamp
 */
export async function getHistoricalData(
  ticker: string, 
  timestamp: string
): Promise<SnapshotData> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/historical-data?ticker=${ticker}&timestamp=${encodeURIComponent(timestamp)}`
    )
    if (!response.ok) throw new Error(`Failed to fetch historical data for ${ticker}`)
    const data = await response.json()
    return data.data
  } catch (error) {
    console.error(`Error fetching historical data for ${ticker}:`, error)
    throw error
  }
}

/**
 * Get all available timestamps for a ticker
 */
export async function getTimestamps(ticker: string): Promise<TimestampInfo[]> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/timestamps?ticker=${ticker}`)
    if (!response.ok) throw new Error(`Failed to fetch timestamps for ${ticker}`)
    const data = await response.json()
    return data.data
  } catch (error) {
    console.error(`Error fetching timestamps for ${ticker}:`, error)
    throw error
  }
}

/**
 * Get available expiries at a specific timestamp
 */
export async function getExpiries(
  ticker: string, 
  timestamp: string
): Promise<ExpiryInfo[]> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/expiries?ticker=${ticker}&timestamp=${encodeURIComponent(timestamp)}`
    )
    if (!response.ok) throw new Error(`Failed to fetch expiries for ${ticker}`)
    const data = await response.json()
    return data.data
  } catch (error) {
    console.error(`Error fetching expiries for ${ticker}:`, error)
    throw error
  }
}

/**
 * Get database statistics
 */
export async function getStats(): Promise<StatsData[]> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/stats`)
    if (!response.ok) throw new Error('Failed to fetch stats')
    const data = await response.json()
    return data.data
  } catch (error) {
    console.error('Error fetching stats:', error)
    throw error
  }
}

/**
 * Trigger manual data collection
 */
export async function triggerCollection(): Promise<{ message: string; timestamp: string }> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/collect-now`, {
      method: 'POST'
    })
    if (!response.ok) throw new Error('Failed to trigger collection')
    return await response.json()
  } catch (error) {
    console.error('Error triggering collection:', error)
    throw error
  }
}

/**
 * Calculate GEX (Gamma Exposure) for options data
 */
export function calculateGEX(options: OptionData[], spotPrice: number): Map<number, number> {
  const gexByStrike = new Map<number, number>()
  
  options.forEach(option => {
    const strike = option.strike
    const gamma = option.gamma
    const oi = option.openInterest
    
    // GEX formula: Gamma × OI × 100 × Spot² / 1e9
    // Calls are positive, Puts are negative
    const multiplier = option.type === 'C' ? 1 : -1
    const gex = (gamma * oi * 100 * spotPrice * spotPrice / 1e9) * multiplier
    
    const currentGex = gexByStrike.get(strike) || 0
    gexByStrike.set(strike, currentGex + gex)
  })
  
  return gexByStrike
}

/**
 * Calculate total GEX (sum across all strikes)
 */
export function calculateTotalGEX(options: OptionData[], spotPrice: number): number {
  const gexByStrike = calculateGEX(options, spotPrice)
  return Array.from(gexByStrike.values()).reduce((sum, gex) => sum + gex, 0)
}

/**
 * Filter options by expiry date
 */
export function filterByExpiry(options: OptionData[], expiry: string): OptionData[] {
  return options.filter(opt => opt.expiration === expiry)
}

/**
 * Get unique expiry dates from options
 */
export function getUniqueExpiries(options: OptionData[]): string[] {
  const expiries = new Set(options.map(opt => opt.expiration))
  return Array.from(expiries).sort()
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
}

/**
 * Format expiry date for display
 */
export function formatExpiry(expiry: string): string {
  const date = new Date(expiry)
  const today = new Date()
  const diffTime = date.getTime() - today.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) return 'Today (0DTE)'
  if (diffDays === 1) return 'Tomorrow (1DTE)'
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
  }) + ` (${diffDays}DTE)`
}

// ─── Trading Journal Backend Sync Services ───────────────────────────

export interface JournalTrade {
  id: string
  tradeDate: string // YYYY-MM-DD
  timeEntered: string | null // HH:MM
  timeExited: string | null // HH:MM
  ticker: string
  tradeType: 'Equity' | 'Option'
  strike?: number | null
  optionType?: 'C' | 'P' | null
  expiration?: string | null // YYYY-MM-DD
  direction: 'Buy' | 'Sell'
  quality: 'S' | 'A' | 'B'
  pnl: number
  pnlPercent: number
  screenshot?: string | null // Base64 JPEG string
  rationale?: string | null
  strategy?: string | null
  quantity: number
  entryPrice: number
  exitPrice: number
  fees?: number | null
  status?: 'Open' | 'Closed' | null
  createdAt?: string
}


/**
 * Get all journal trades from backend
 */
export async function getJournalTrades(): Promise<JournalTrade[]> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/journal/trades`)
    if (!response.ok) throw new Error('Failed to fetch journal trades')
    const data = await response.json()
    return data.data
  } catch (error) {
    console.error('Error fetching journal trades from backend:', error)
    throw error
  }
}

/**
 * Save a new journal trade to database via backend
 */
export async function createJournalTrade(trade: JournalTrade): Promise<JournalTrade> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/journal/trades`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(trade)
    })
    if (!response.ok) throw new Error('Failed to create journal trade')
    const data = await response.json()
    return data.data
  } catch (error) {
    console.error('Error creating journal trade via backend:', error)
    throw error
  }
}

/**
 * Update an existing journal trade in database via backend
 */
export async function updateJournalTrade(id: string, trade: Partial<JournalTrade>): Promise<JournalTrade> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/journal/trades/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(trade)
    })
    if (!response.ok) throw new Error(`Failed to update journal trade ${id}`)
    const data = await response.json()
    return data.data
  } catch (error) {
    console.error(`Error updating journal trade ${id} via backend:`, error)
    throw error
  }
}

/**
 * Delete a journal trade from database via backend
 */
export async function deleteJournalTrade(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/journal/trades/${id}`, {
      method: 'DELETE'
    })
    if (!response.ok) throw new Error(`Failed to delete journal trade ${id}`)
    const data = await response.json()
    return data.success
  } catch (error) {
    console.error(`Error deleting journal trade ${id} via backend:`, error)
    throw error
  }
}

/**
 * Get a configuration setting by key
 */
export async function getJournalSetting(key: string): Promise<string | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/journal/settings/${key}`)
    if (!response.ok) return null
    const data = await response.json()
    return data.value
  } catch (error) {
    console.error(`Error fetching journal setting ${key} from backend:`, error)
    return null
  }
}

/**
 * Update a configuration setting
 */
export async function updateJournalSetting(key: string, value: string): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/journal/settings/${key}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value })
    })
    if (!response.ok) throw new Error(`Failed to update setting ${key}`)
    const data = await response.json()
    return data.success
  } catch (error) {
    console.error(`Error updating journal setting ${key} via backend:`, error)
    return false
  }
}

export interface OptionFlowItem {
  id: string
  time: string
  ticker: string
  contractName: string
  optionType: 'Call' | 'Put'
  strike: number
  expiration: string
  stockPrice: number
  lastPrice: number
  changePercent: number | null
  volume: number
  openInterest: number
  oiChange: number // Signed OI change
  notionalChange: number // |oiChange| * lastPrice * 100
  timeframeType: 'Intraday' | 'Daily' | '5-Day' | 'Custom'
  oi5dChangePercent: number | null
  otmPercent: number
  ivPercent: number
  iv5dPointDiff: number | null
  delta: number
  dte: number
  earningsRemainingDays: number | null
  bid?: number
  ask?: number
}

export interface FlowAggregates {
  dominantSentiment: 'Bullish' | 'Bearish' | 'Neutral'
  bullishSentimentPercent: number
  putCallRatio: number
  callVolume: number
  putVolume: number
  callPremium: number
  putPremium: number
  callPercentage: number
  putPercentage: number
}

export interface OptionsFlowResponse {
  data: OptionFlowItem[]
  aggregates: FlowAggregates
  topNotionalStrikes: OptionFlowItem[]
}

/**
 * Fetch options flow data from backend with timeframe and optional custom startDate
 */
export async function getOptionsFlowData(
  ticker: string,
  timeframe: 'Intraday' | 'Daily' | '5-Day' | 'Custom' = 'Intraday',
  startDate?: string
): Promise<OptionsFlowResponse> {
  try {
    let url = `${BACKEND_URL}/api/options/flow?ticker=${ticker}&timeframe=${timeframe}`
    if (startDate) {
      url += `&startDate=${encodeURIComponent(startDate)}`
    }
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to fetch options flow data for ${ticker}`)
    const data = await response.json()
    return {
      data: data.data || [],
      aggregates: data.aggregates || {
        dominantSentiment: 'Neutral',
        bullishSentimentPercent: 50,
        putCallRatio: 1,
        callVolume: 0,
        putVolume: 0,
        callPremium: 0,
        putPremium: 0,
        callPercentage: 50,
        putPercentage: 50
      },
      topNotionalStrikes: data.topNotionalStrikes || []
    }
  } catch (error) {
    console.error(`Error fetching options flow data for ${ticker}:`, error)
    throw error
  }
}

/**
 * Generate AI analyst briefing for a ticker
 */
export async function getAIBriefing(ticker: string, timeframe: 'Intraday' | 'Daily' | '5-Day' = 'Intraday'): Promise<string> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/analyze?ticker=${ticker}&timeframe=${timeframe}`)
    if (!response.ok) throw new Error(`Failed to fetch AI briefing for ${ticker}`)
    const data = await response.json()
    return data.analysis || "Failed to retrieve briefing."
  } catch (error) {
    console.error(`Error fetching AI briefing for ${ticker}:`, error)
    return `Error retrieving briefing: ${(error as any).message}`
  }
}

/**
 * Send chat message to AI analyst agent
 */
export async function sendAIChatMessage(
  message: string,
  history: Array<{ role: 'user' | 'model'; text: string }> = [],
  ticker: string = 'SPX',
  livePrice?: number
): Promise<{ text: string; tradeLogged?: JournalTrade }> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/analyst/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message, history, ticker, livePrice })
    })
    if (!response.ok) throw new Error('Failed to communicate with AI Analyst')
    return await response.json()
  } catch (error) {
    console.error('Error sending message to AI analyst:', error)
    return { text: `Communication error: ${(error as any).message}` }
  }
}



