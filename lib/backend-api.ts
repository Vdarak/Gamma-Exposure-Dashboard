// API service to communicate with Railway backend

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

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
