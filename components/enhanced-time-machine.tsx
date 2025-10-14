"use client"

/**
 * Enhanced Time Machine Component
 * 
 * Layout matches screenshot:
 * - Top: Time slider with play controls
 * - Left: Price chart (Coming Soon)
 * - Right: GEX by Strike chart (aligned strikes)
 */

import { useState, useEffect, useMemo } from 'react'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Clock, SkipForward, Play, Pause, Calendar, Activity } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import dynamic from 'next/dynamic'

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

interface TimestampInfo {
  timestamp: Date
  spotPrice: number
}

interface OptionData {
  strike: number
  type: 'C' | 'P'
  expiration: Date
  lastPrice: number
  volume: number
  openInterest: number
  impliedVolatility: number
  gamma?: number
}

interface SnapshotData {
  id: number
  ticker: string
  timestamp: string
  spot_price: number
  options: OptionData[]
}

interface EnhancedTimeMachineProps {
  ticker?: string
  onTimestampChange?: (timestamp: Date | null) => void
  onDataUpdate?: (data: any) => void
  backendUrl?: string
}

// Market and ticker configuration
const US_TICKERS = ['SPX', 'SPY']
const INDIA_TICKERS = ['NIFTY', 'BANKNIFTY']

export function EnhancedTimeMachine({ 
  ticker: initialTicker, 
  onTimestampChange, 
  onDataUpdate,
  backendUrl 
}: EnhancedTimeMachineProps) {
  // Use environment variable for backend URL or fallback
  const BACKEND_URL = backendUrl || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'
  
  // Market and ticker state
  const [market, setMarket] = useState<'us' | 'india'>('india')
  const [ticker, setTicker] = useState<string>(initialTicker || 'NIFTY')
  
  const [timestamps, setTimestamps] = useState<TimestampInfo[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [isLive, setIsLive] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [optionData, setOptionData] = useState<SnapshotData | null>(null)
  const [healthStatus, setHealthStatus] = useState<'checking' | 'healthy' | 'unhealthy' | null>(null)
  
  // GEX visualization controls
  const [strikeCount, setStrikeCount] = useState<number>(12)
  const [selectedExpiry, setSelectedExpiry] = useState<string>('nearest')
  
  // Get available expiries from option data
  const availableExpiries = useMemo(() => {
    if (!optionData?.options) return []
    const expiries = [...new Set(optionData.options.map(opt => 
      new Date(opt.expiration).toISOString().split('T')[0]
    ))].sort()
    return expiries
  }, [optionData])
  
  // Calculate GEX by strike
  const gexByStrike = useMemo(() => {
    if (!optionData?.options) return { strikes: [], callGEX: [], putGEX: [], netGEX: [], spotPrice: 0 }
    
    const spotPrice = optionData.spot_price
    let filteredOptions = optionData.options
    
    // Filter by selected expiry
    if (selectedExpiry !== 'all' && selectedExpiry !== 'nearest') {
      filteredOptions = filteredOptions.filter(opt => 
        new Date(opt.expiration).toISOString().split('T')[0] === selectedExpiry
      )
    } else if (selectedExpiry === 'nearest' && availableExpiries.length > 0) {
      filteredOptions = filteredOptions.filter(opt =>
        new Date(opt.expiration).toISOString().split('T')[0] === availableExpiries[0]
      )
    }
    
    // Group by strike and calculate GEX
    const strikeMap = new Map<number, { callGEX: number; putGEX: number }>()
    
    filteredOptions.forEach(opt => {
      if (!opt.gamma) return
      
      const gex = opt.openInterest * opt.gamma * spotPrice * spotPrice * 0.01
      const current = strikeMap.get(opt.strike) || { callGEX: 0, putGEX: 0 }
      
      if (opt.type === 'C') {
        current.callGEX += gex
      } else {
        current.putGEX -= gex // Negative for puts (dealer short gamma)
      }
      
      strikeMap.set(opt.strike, current)
    })
    
    // Convert to sorted arrays
    const sortedStrikes = Array.from(strikeMap.keys()).sort((a, b) => a - b)
    
    // Filter to show strikes around spot price
    let displayStrikes = sortedStrikes
    if (strikeCount !== 0) { // 0 means 'all'
      const spotIndex = sortedStrikes.findIndex(s => s >= spotPrice)
      const halfCount = Math.floor(strikeCount / 2)
      const startIdx = Math.max(0, spotIndex - halfCount)
      const endIdx = Math.min(sortedStrikes.length, startIdx + strikeCount)
      displayStrikes = sortedStrikes.slice(startIdx, endIdx)
    }
    
    const strikes = displayStrikes
    const callGEX = strikes.map(s => strikeMap.get(s)!.callGEX / 1e9) // Convert to billions
    const putGEX = strikes.map(s => strikeMap.get(s)!.putGEX / 1e9)
    const netGEX = strikes.map((s, i) => callGEX[i] + putGEX[i])
    
    return { strikes, callGEX, putGEX, netGEX, spotPrice }
  }, [optionData, strikeCount, selectedExpiry, availableExpiries])

  useEffect(() => {
    fetchTimestamps()
  }, [ticker, backendUrl])

  useEffect(() => {
    if (selectedIndex !== null && timestamps[selectedIndex]) {
      fetchHistoricalData(timestamps[selectedIndex].timestamp)
    } else if (isLive) {
      fetchCurrentData()
    }
  }, [selectedIndex, isLive, ticker])

  // Auto-play functionality
  useEffect(() => {
    if (!isPlaying || !timestamps.length || isLive) return

    const interval = setInterval(() => {
      setSelectedIndex(prev => {
        const nextIndex = (prev ?? 0) + 1
        if (nextIndex >= timestamps.length - 1) {
          setIsPlaying(false)
          return timestamps.length - 1
        }
        return nextIndex
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [isPlaying, timestamps, selectedIndex])
  
  // Reset state when ticker changes
  useEffect(() => {
    setIsLive(true)
    setSelectedIndex(null)
    setSelectedExpiry('nearest')
    fetchTimestamps()
  }, [ticker])

  async function checkHealth() {
    setHealthStatus('checking')
    try {
      const response = await fetch(`${BACKEND_URL}/health`)
      if (response.ok) {
        const result = await response.json()
        setHealthStatus(result.status === 'ok' ? 'healthy' : 'unhealthy')
      } else {
        setHealthStatus('unhealthy')
      }
    } catch (err) {
      console.error('Health check failed:', err)
      setHealthStatus('unhealthy')
    }
    
    // Reset status after 3 seconds
    setTimeout(() => setHealthStatus(null), 3000)
  }

  async function fetchTimestamps() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${BACKEND_URL}/api/timestamps?ticker=${ticker}`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch timestamps')
      }
      
      const result = await response.json()
      
      if (result.success && result.data) {
        const timestampData = result.data.map((d: any) => ({
          timestamp: new Date(d.timestamp),
          spotPrice: d.spotPrice,
        }))
        setTimestamps(timestampData)
        
        if (timestampData.length > 0) {
          setSelectedIndex(timestampData.length - 1)
        }
      } else {
        setError('No historical data available yet')
      }
    } catch (err) {
      console.error('Error fetching timestamps:', err)
      setError('Backend not connected. Showing sample data.')
    } finally {
      setLoading(false)
    }
  }

  async function fetchCurrentData() {
    try {
      const response = await fetch(`${BACKEND_URL}/api/current-data?ticker=${ticker}`)
      if (response.ok) {
        const result = await response.json()
        if (result.success && result.data) {
          setOptionData(result.data)
          onDataUpdate?.(result.data)
        }
      }
    } catch (err) {
      console.error('Error fetching current data:', err)
    }
  }

  async function fetchHistoricalData(timestamp: Date) {
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/historical-data?ticker=${ticker}&timestamp=${timestamp.toISOString()}`
      )
      if (response.ok) {
        const result = await response.json()
        if (result.success && result.data && result.data.length > 0) {
          setOptionData(result.data[0])
          onDataUpdate?.(result.data[0])
        }
      }
    } catch (err) {
      console.error('Error fetching historical data:', err)
    }
  }

  function handleSliderChange(value: number[]) {
    const index = value[0]
    setSelectedIndex(index)
    setIsLive(index === timestamps.length - 1)
    setIsPlaying(false)
    
    if (index === timestamps.length - 1) {
      onTimestampChange?.(null)
    } else {
      onTimestampChange?.(timestamps[index].timestamp)
    }
  }

  function goLive() {
    setIsLive(true)
    setIsPlaying(false)
    setSelectedIndex(timestamps.length - 1)
    onTimestampChange?.(null)
  }

  function togglePlayPause() {
    if (isLive && timestamps.length > 0) {
      setSelectedIndex(0)
      setIsLive(false)
      onTimestampChange?.(timestamps[0].timestamp)
    }
    setIsPlaying(!isPlaying)
  }

  if (loading) {
    return (
      <div className="bg-[#0A0E1A] rounded-lg p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-400">Loading time machine...</span>
        </div>
      </div>
    )
  }

  const currentTimestamp = selectedIndex !== null && timestamps[selectedIndex]
    ? timestamps[selectedIndex].timestamp 
    : new Date()
  const currentSpotPrice = selectedIndex !== null && timestamps[selectedIndex]
    ? timestamps[selectedIndex].spotPrice 
    : 0
  const oldestTimestamp = timestamps[0]?.timestamp
  const newestTimestamp = timestamps[timestamps.length - 1]?.timestamp

  return (
    <div className="space-y-4">
      {/* Market & Ticker Selection */}
      <Card className="bg-[#0A0E1A] border-gray-800">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Market:</span>
                <Tabs value={market} onValueChange={(v) => setMarket(v as 'us' | 'india')}>
                  <TabsList className="bg-[#181C2A] border-gray-700">
                    <TabsTrigger 
                      value="us" 
                      className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                    >
                      US (CBOE)
                    </TabsTrigger>
                    <TabsTrigger 
                      value="india"
                      className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                    >
                      India (NSE)
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Ticker:</span>
                <div className="flex gap-2">
                  {(market === 'us' ? US_TICKERS : INDIA_TICKERS).map((t) => (
                    <Button
                      key={t}
                      onClick={() => setTicker(t)}
                      variant={ticker === t ? "default" : "outline"}
                      size="sm"
                      className={
                        ticker === t
                          ? "bg-blue-600 hover:bg-blue-700 text-white"
                          : "bg-[#181C2A] border-gray-700 hover:bg-[#252A3A] text-white"
                      }
                    >
                      {t}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            
            <Button
              onClick={checkHealth}
              variant="outline"
              size="sm"
              disabled={healthStatus === 'checking'}
              className={
                healthStatus === 'healthy'
                  ? 'bg-green-600 border-green-500 hover:bg-green-700 text-white'
                  : healthStatus === 'unhealthy'
                  ? 'bg-red-600 border-red-500 hover:bg-red-700 text-white'
                  : 'bg-[#181C2A] border-gray-700 hover:bg-[#252A3A] text-white'
              }
            >
              {healthStatus === 'checking' ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2"></div>
                  Checking...
                </>
              ) : healthStatus === 'healthy' ? (
                <>
                  <Activity className="h-4 w-4 mr-1" />
                  Backend OK
                </>
              ) : healthStatus === 'unhealthy' ? (
                <>
                  <Activity className="h-4 w-4 mr-1" />
                  Backend Down
                </>
              ) : (
                <>
                  <Activity className="h-4 w-4 mr-1" />
                  Check Backend
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>
      
      {/* Time Control Bar */}
      <Card className="bg-[#0A0E1A] border-gray-800">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-blue-400" />
              <div>
                <h3 className="text-lg font-semibold text-white">Time Machine</h3>
                <p className="text-xs text-gray-400">
                  {timestamps.length} snapshots • {ticker} @ ${currentSpotPrice.toFixed(2)}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                onClick={togglePlayPause}
                disabled={isLive || timestamps.length === 0}
                variant="outline"
                size="sm"
                className="bg-[#181C2A] border-gray-700 hover:bg-[#252A3A] text-white"
              >
                {isPlaying ? (
                  <>
                    <Pause className="h-4 w-4 mr-1" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-1" />
                    Play
                  </>
                )}
              </Button>
              
              <Button
                onClick={goLive}
                disabled={isLive}
                variant={isLive ? "default" : "outline"}
                size="sm"
                className={
                  isLive
                    ? 'bg-green-600 hover:bg-green-700 border-green-500 text-white'
                    : 'bg-[#181C2A] border-gray-700 hover:bg-[#252A3A] text-white'
                }
              >
                {isLive ? (
                  <>
                    <span className="relative flex h-2 w-2 mr-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                    </span>
                    LIVE
                  </>
                ) : (
                  <>
                    <SkipForward className="h-4 w-4 mr-1" />
                    Go Live
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Timeline Slider */}
          {timestamps.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="text-gray-300 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  {currentTimestamp.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                
                <Badge variant="outline" className="bg-[#181C2A] border-gray-700 text-white">
                  {selectedIndex !== null ? selectedIndex + 1 : timestamps.length} / {timestamps.length}
                </Badge>
              </div>

              <Slider
                value={[selectedIndex ?? timestamps.length - 1]}
                min={0}
                max={timestamps.length - 1}
                step={1}
                onValueChange={handleSliderChange}
                className="w-full cursor-pointer"
                disabled={timestamps.length <= 1}
              />

              <div className="flex justify-between text-xs text-gray-500">
                <span>
                  {oldestTimestamp?.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span>
                  {newestTimestamp?.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 text-xs text-yellow-500 bg-yellow-500/10 rounded px-3 py-2">
              ⚠️ {error}
            </div>
          )}
        </div>
      </Card>

      {/* Chart Layout - Matching Screenshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Price Chart (Coming Soon) */}
        <Card className="bg-[#0A0E1A] border-gray-800">
          <div className="p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              {ticker} Price Chart
            </h3>
            <div className="h-[400px] flex items-center justify-center border-2 border-dashed border-gray-700 rounded-lg">
              <div className="text-center">
                <Calendar className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 text-lg font-medium">Coming Soon</p>
                <p className="text-gray-500 text-sm mt-2">
                  Historical price chart with aligned strikes
                </p>
                <div className="mt-4 text-xs text-gray-600">
                  <p>Free chart options:</p>
                  <ul className="mt-2 space-y-1">
                    <li>• <span className="text-blue-400">TradingView Lightweight Charts</span> (Recommended)</li>
                    <li>• <span className="text-blue-400">Recharts</span> + Yahoo Finance API</li>
                    <li>• <span className="text-blue-400">Chart.js</span> + Alpha Vantage</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Right: GEX Chart */}
        <Card className="bg-[#0A0E1A] border-gray-800">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                Gamma Exposure by Strike
              </h3>
              
              {/* GEX Controls */}
              <div className="flex items-center gap-4">
                {/* Strike Count Presets */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Strikes:</span>
                  <div className="flex gap-1">
                    {[6, 12, 18, 24].map((count) => (
                      <Button
                        key={count}
                        onClick={() => setStrikeCount(count)}
                        variant={strikeCount === count ? "default" : "outline"}
                        size="sm"
                        className={
                          strikeCount === count
                            ? "bg-blue-600 hover:bg-blue-700 text-white h-7 px-2 text-xs"
                            : "bg-[#181C2A] border-gray-700 hover:bg-[#252A3A] text-white h-7 px-2 text-xs"
                        }
                      >
                        {count}
                      </Button>
                    ))}
                    <Button
                      onClick={() => setStrikeCount(0)}
                      variant={strikeCount === 0 ? "default" : "outline"}
                      size="sm"
                      className={
                        strikeCount === 0
                          ? "bg-blue-600 hover:bg-blue-700 text-white h-7 px-2 text-xs"
                          : "bg-[#181C2A] border-gray-700 hover:bg-[#252A3A] text-white h-7 px-2 text-xs"
                      }
                    >
                      All
                    </Button>
                  </div>
                </div>
                
                {/* Expiry Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Expiry:</span>
                  <Select value={selectedExpiry} onValueChange={setSelectedExpiry}>
                    <SelectTrigger className="w-[120px] h-7 text-xs bg-[#181C2A] border-gray-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#181C2A] border-gray-700">
                      <SelectItem value="nearest" className="text-white hover:bg-[#252A3A]">
                        Nearest
                      </SelectItem>
                      <SelectItem value="all" className="text-white hover:bg-[#252A3A]">
                        All
                      </SelectItem>
                      {availableExpiries.map((expiry) => (
                        <SelectItem 
                          key={expiry} 
                          value={expiry}
                          className="text-white hover:bg-[#252A3A]"
                        >
                          {new Date(expiry).toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            
            <div className="h-[400px]">
              {!optionData ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-gray-500">Waiting for data...</p>
                </div>
              ) : gexByStrike.strikes.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-gray-500">No options data available for selected filters</p>
                </div>
              ) : (
                <Plot
                  data={[
                    // Call GEX (Green Bars)
                    {
                      x: gexByStrike.strikes,
                      y: gexByStrike.callGEX,
                      type: 'bar',
                      name: 'Call GEX',
                      marker: { color: '#10b981' },
                      yaxis: 'y',
                    },
                    // Put GEX (Red Bars)
                    {
                      x: gexByStrike.strikes,
                      y: gexByStrike.putGEX,
                      type: 'bar',
                      name: 'Put GEX',
                      marker: { color: '#ef4444' },
                      yaxis: 'y',
                    },
                    // Net GEX (Blue Line)
                    {
                      x: gexByStrike.strikes,
                      y: gexByStrike.netGEX,
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: 'Net GEX',
                      line: { color: '#3b82f6', width: 2 },
                      marker: { size: 6 },
                      yaxis: 'y2',
                    },
                    // Spot Price Line
                    {
                      x: [gexByStrike.spotPrice, gexByStrike.spotPrice],
                      y: [
                        Math.min(...gexByStrike.putGEX) * 1.2,
                        Math.max(...gexByStrike.callGEX) * 1.2
                      ],
                      type: 'scatter',
                      mode: 'lines',
                      name: 'Spot Price',
                      line: { color: '#fbbf24', width: 2, dash: 'dash' },
                      showlegend: true,
                      yaxis: 'y',
                    },
                  ]}
                  layout={{
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)',
                    font: { color: '#9ca3af', size: 10 },
                    margin: { l: 60, r: 60, t: 20, b: 40 },
                    xaxis: {
                      title: 'Strike Price',
                      gridcolor: '#374151',
                      color: '#9ca3af',
                    },
                    yaxis: {
                      title: 'GEX (Billions)',
                      gridcolor: '#374151',
                      color: '#9ca3af',
                      side: 'left',
                    },
                    yaxis2: {
                      title: 'Net GEX (Billions)',
                      overlaying: 'y',
                      side: 'right',
                      gridcolor: 'transparent',
                      color: '#3b82f6',
                    },
                    legend: {
                      orientation: 'h',
                      yanchor: 'bottom',
                      y: 1.02,
                      xanchor: 'center',
                      x: 0.5,
                      font: { size: 10 },
                    },
                    hovermode: 'x unified',
                  }}
                  config={{
                    displayModeBar: false,
                    responsive: true,
                  }}
                  style={{ width: '100%', height: '100%' }}
                />
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
