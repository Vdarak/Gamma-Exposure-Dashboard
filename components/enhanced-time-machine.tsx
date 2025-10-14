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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GEXByStrikeChart } from '@/components/charts/gex-by-strike-chart'
import type { OptionData } from '@/lib/types'
import type { PricingMethod } from '@/lib/calculations'

interface TimestampInfo {
  timestamp: Date
  spotPrice: number
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
  
  // Pricing method state (for Indian markets, force Black-Scholes)
  const [pricingMethod, setPricingMethod] = useState<PricingMethod>('black-scholes')
  
  // GEX visualization controls
  const [selectedExpiry, setSelectedExpiry] = useState<string>('All Dates')
  
  // Convert backend data to OptionData format
  const convertedOptions = useMemo((): OptionData[] => {
    if (!optionData?.options) return []
    
    return optionData.options.map(opt => ({
      option: `${ticker} ${opt.strike} ${opt.type}`,
      strike: opt.strike,
      type: opt.type,
      expiration: new Date(opt.expiration),
      last: opt.last || 0,
      bid: opt.bid || 0,
      ask: opt.ask || 0,
      volume: opt.volume || 0,
      open_interest: opt.open_interest || 0,
      iv: opt.iv || 0.2,
      delta: opt.delta || 0,
      gamma: opt.gamma || 0,
    }))
  }, [optionData, ticker])
  
  // Get available expiries from option data
  const availableExpiries = useMemo(() => {
    if (!convertedOptions.length) return []
    const expiries = [...new Set(convertedOptions.map(opt => 
      opt.expiration.toISOString().split('T')[0]
    ))].sort()
    return expiries
  }, [convertedOptions])

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
            <h3 className="text-lg font-semibold text-white mb-4">
              Gamma Exposure by Strike
            </h3>
            {convertedOptions.length > 0 ? (
              <GEXByStrikeChart
                data={convertedOptions}
                ticker={ticker}
                spotPrice={optionData?.spot_price || 0}
                selectedExpiry={selectedExpiry}
                pricingMethod={pricingMethod}
                onPricingMethodChange={setPricingMethod}
                market={market === 'us' ? 'USA' : 'INDIA'}
              />
            ) : (
              <div className="h-[400px] flex items-center justify-center">
                <p className="text-gray-500">Waiting for data...</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
