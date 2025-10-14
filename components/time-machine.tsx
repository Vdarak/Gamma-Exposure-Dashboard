"use client"

import { useState, useEffect } from 'react'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Clock, SkipForward, Play, Pause } from 'lucide-react'

interface TimestampInfo {
  timestamp: Date
  spotPrice: number
}

interface TimeMachineProps {
  ticker: string
  onTimestampChange: (timestamp: Date | null) => void
  backendUrl?: string
}

export function TimeMachine({ ticker, onTimestampChange, backendUrl = 'http://localhost:3001' }: TimeMachineProps) {
  const [timestamps, setTimestamps] = useState<TimestampInfo[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [isLive, setIsLive] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTimestamps()
  }, [ticker, backendUrl])

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
        onTimestampChange(timestamps[nextIndex].timestamp)
        return nextIndex
      })
    }, 2000) // Change every 2 seconds

    return () => clearInterval(interval)
  }, [isPlaying, timestamps, isLive, onTimestampChange])

  async function fetchTimestamps() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${backendUrl}/api/timestamps?ticker=${ticker}`)
      
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
        
        // Start at the latest timestamp
        if (timestampData.length > 0) {
          setSelectedIndex(timestampData.length - 1)
        }
      } else {
        setError('No historical data available yet')
      }
    } catch (err) {
      console.error('Error fetching timestamps:', err)
      setError('Failed to connect to backend. Make sure it\'s running.')
    } finally {
      setLoading(false)
    }
  }

  function handleSliderChange(value: number[]) {
    const index = value[0]
    setSelectedIndex(index)
    setIsLive(index === timestamps.length - 1)
    setIsPlaying(false)
    
    if (index === timestamps.length - 1) {
      onTimestampChange(null) // Live data
    } else {
      onTimestampChange(timestamps[index].timestamp)
    }
  }

  function goLive() {
    setIsLive(true)
    setIsPlaying(false)
    setSelectedIndex(timestamps.length - 1)
    onTimestampChange(null)
  }

  function togglePlayPause() {
    if (isLive) {
      // Start from the beginning if we're at live
      setSelectedIndex(0)
      setIsLive(false)
      onTimestampChange(timestamps[0].timestamp)
    }
    setIsPlaying(!isPlaying)
  }

  if (loading) {
    return (
      <Card className="bg-[#181C2A] border-gray-800">
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-400">Loading time machine...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="bg-[#181C2A] border-gray-800">
        <CardContent className="p-6">
          <div className="text-center">
            <p className="text-red-400 mb-2">{error}</p>
            <Button onClick={fetchTimestamps} variant="outline" size="sm">
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (timestamps.length === 0) {
    return (
      <Card className="bg-[#181C2A] border-gray-800">
        <CardContent className="p-6">
          <p className="text-gray-400 text-center">
            No historical data available yet. Data collection will start automatically.
          </p>
        </CardContent>
      </Card>
    )
  }

  const currentTimestamp = selectedIndex !== null ? timestamps[selectedIndex].timestamp : new Date()
  const currentSpotPrice = selectedIndex !== null ? timestamps[selectedIndex].spotPrice : 0
  const oldestTimestamp = timestamps[0]?.timestamp
  const newestTimestamp = timestamps[timestamps.length - 1]?.timestamp

  return (
    <Card className="bg-[#181C2A] border-gray-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-blue-400" />
            <div>
              <CardTitle className="text-lg">Time Machine</CardTitle>
              <CardDescription className="text-xs text-gray-400">
                {timestamps.length} snapshots available
              </CardDescription>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              onClick={togglePlayPause}
              disabled={isLive}
              variant="outline"
              size="sm"
              className="bg-[#1E2332] border-gray-700 hover:bg-[#252A3A]"
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
                  ? 'bg-green-600 hover:bg-green-700 border-green-500'
                  : 'bg-[#1E2332] border-gray-700 hover:bg-[#252A3A]'
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
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-300">
                {currentTimestamp.toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              {currentSpotPrice > 0 && (
                <div className="text-xs text-gray-400">
                  Spot Price: ${currentSpotPrice.toFixed(2)}
                </div>
              )}
            </div>
            
            <Badge variant="outline" className="bg-[#1E2332] border-gray-700">
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
              {oldestTimestamp?.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span>
              {newestTimestamp?.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-800">
          <div className="text-xs text-gray-400">
            💡 Tip: Use the slider to travel through time, or click Play to watch data evolve automatically
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
