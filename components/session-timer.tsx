"use client"

import React, { useEffect, useState, useRef } from "react"
import { Play, Pause, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { BACKEND_URL } from "@/lib/backend-api"

interface TimestampInfo {
  timestamp: string
  spotPrice: number
}

interface SessionTimerProps {
  ticker: string
  currentRange: [string | null, string | null]
  onCheckpointChange: (start: string | null, end: string | null, isLive: boolean) => void
  isLive: boolean
  onLiveChange: (live: boolean) => void
  onTimestampsLoad?: (timestamps: string[]) => void
}

export function SessionTimer({
  ticker,
  currentRange,
  onCheckpointChange,
  isLive,
  onLiveChange,
  onTimestampsLoad,
}: SessionTimerProps) {
  const [checkpoints, setCheckpoints] = useState<TimestampInfo[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch checkpoints
  const fetchCheckpoints = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/timestamps?ticker=${ticker}&days=1`)
      if (!res.ok) throw new Error("Failed to fetch checkpoints")
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) {
        const sorted = json.data.sort((a: TimestampInfo, b: TimestampInfo) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        setCheckpoints(sorted)
        
        // Notify parent of loaded timestamp strings
        if (onTimestampsLoad) {
          onTimestampsLoad(sorted.map((item: TimestampInfo) => item.timestamp))
        }

        // Handle initial selection if not set or if we are in live mode
        if (sorted.length > 0) {
          if (isLive || !currentRange[0] || !currentRange[1]) {
            const latest = sorted[sorted.length - 1].timestamp
            onCheckpointChange(latest, latest, isLive)
          }
        }
      }
    } catch (err) {
      console.error("Error loading checkpoints in SessionTimer:", err)
    } finally {
      setLoading(false)
    }
  }

  // Reload checkpoints when ticker changes or every 60 seconds (background sync)
  useEffect(() => {
    fetchCheckpoints()
  }, [ticker])

  // Poll for new checkpoints every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      // Background reload (silent)
      fetch(`${BACKEND_URL}/api/timestamps?ticker=${ticker}&days=1`)
        .then(res => res.json())
        .then(json => {
          if (json.success && Array.isArray(json.data)) {
            const sorted = json.data.sort((a: TimestampInfo, b: TimestampInfo) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            )
            setCheckpoints(sorted)
            
            if (onTimestampsLoad) {
              onTimestampsLoad(sorted.map((item: TimestampInfo) => item.timestamp))
            }

            if (sorted.length > 0 && isLive) {
              const latest = sorted[sorted.length - 1].timestamp
              if (latest !== currentRange[1]) {
                // Silently transition to latest in LIVE mode
                onCheckpointChange(latest, latest, true)
              }
            }
          }
        })
        .catch(err => console.warn("Background checkpoint sync failed:", err))
    }, 60000)

    return () => clearInterval(interval)
  }, [ticker, isLive, currentRange])

  // Handle Play/Pause Automation
  useEffect(() => {
    if (isPlaying) {
      // Turn off LIVE mode when starting playback
      if (isLive) {
        onLiveChange(false)
      }

      playIntervalRef.current = setInterval(() => {
        setCheckpoints((currentCheckpoints) => {
          if (currentCheckpoints.length === 0) return currentCheckpoints
          
          const endIdx = currentCheckpoints.findIndex(
            (c) => c.timestamp === currentRange[1]
          )
          
          let nextEndIndex = endIdx + 1
          let nextStartIndex = currentCheckpoints.findIndex(
            (c) => c.timestamp === currentRange[0]
          )
          if (nextStartIndex === -1) nextStartIndex = 0
          
          if (nextEndIndex >= currentCheckpoints.length || endIdx === -1) {
            nextEndIndex = 0 // Loop back to start
            nextStartIndex = 0
          }
          
          const nextStartCP = currentCheckpoints[nextStartIndex].timestamp
          const nextEndCP = currentCheckpoints[nextEndIndex].timestamp
          // Silent change
          onCheckpointChange(nextStartCP, nextEndCP, false)
          return currentCheckpoints
        })
      }, 2000) // advance every 2 seconds
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
        playIntervalRef.current = null
      }
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
      }
    }
  }, [isPlaying, currentRange, isLive])

  // Get range indexes
  const startIdx = checkpoints.findIndex((c) => c.timestamp === currentRange[0])
  const endIdx = checkpoints.findIndex((c) => c.timestamp === currentRange[1])
  
  const displayStartIdx = startIdx === -1 ? 0 : startIdx
  const displayEndIdx = endIdx === -1 ? Math.max(0, checkpoints.length - 1) : endIdx

  const handleSliderChange = (values: number[]) => {
    setIsPlaying(false) // Pause playback on manual slider move
    if (isLive) {
      onLiveChange(false) // Turn off LIVE mode
    }
    
    let startVal = values[0]
    let endVal = values.length > 1 ? values[1] : values[0]
    
    // Sort values to ensure start index is always <= end index
    if (startVal > endVal) {
      const temp = startVal
      startVal = endVal
      endVal = temp
    }
    
    const startCP = checkpoints[startVal]
    const endCP = checkpoints[endVal]
    if (startCP && endCP) {
      onCheckpointChange(startCP.timestamp, endCP.timestamp, false)
    }
  }

  const togglePlay = () => {
    setIsPlaying(!isPlaying)
  }

  const toggleLive = () => {
    setIsPlaying(false)
    const newLive = !isLive
    onLiveChange(newLive)
    if (newLive && checkpoints.length > 0) {
      const latest = checkpoints[checkpoints.length - 1].timestamp
      onCheckpointChange(latest, latest, true)
    }
  }

  const formatNYTime = (isoString: string | null) => {
    if (!isoString) return "--"
    try {
      const date = new Date(isoString)
      return date.toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    } catch (e) {
      return "--"
    }
  }

  return (
    <div className="w-full bg-[#0E0E12] border border-[#1C1C24] rounded-lg p-3 px-4 flex flex-col md:flex-row items-center gap-4 justify-between select-none">
      <div className="flex items-center gap-3 w-full md:w-auto">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-gray-400 hover:text-white hover:bg-[#1E1E2A] shrink-0"
          onClick={togglePlay}
          disabled={checkpoints.length <= 1}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4 fill-current text-white" />
          ) : (
            <Play className="h-4 w-4 fill-current text-white" />
          )}
        </Button>
        <div className="flex flex-col text-left justify-center min-w-[200px]">
          <span className="text-[11px] text-gray-500 font-medium tracking-wide uppercase">
            Checkpoint Time Range
          </span>
          <span className="text-sm font-semibold text-white font-mono">
            {currentRange[0] === currentRange[1] || !currentRange[1] ? (
              formatNYTime(currentRange[0])
            ) : (
              <span className="text-terminal-green">
                {formatNYTime(currentRange[0])} <span className="text-gray-500">→</span> {formatNYTime(currentRange[1])}
              </span>
            )}
            <span className="text-gray-500 text-xs font-normal ml-2 font-sans">
              ({checkpoints.length > 0 ? `${displayStartIdx + 1} - ${displayEndIdx + 1}` : "0"} / {checkpoints.length})
            </span>
          </span>
        </div>
      </div>

      <div className="flex-1 w-full flex items-center px-2">
        <Slider
          min={0}
          max={Math.max(0, checkpoints.length - 1)}
          step={1}
          value={[displayStartIdx, displayEndIdx]}
          onValueChange={handleSliderChange}
          disabled={checkpoints.length <= 1}
          className="cursor-pointer py-2"
        />
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-gray-400 hover:text-white hover:bg-[#1E1E2A] flex items-center gap-1"
          onClick={fetchCheckpoints}
          disabled={loading}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>

        <Badge
          onClick={toggleLive}
          className={`cursor-pointer h-7 px-3 rounded-full text-xs font-bold transition-all border ${
            isLive
              ? "bg-[#00C805]/10 border-[#00C805] text-[#00C805] hover:bg-[#00C805]/20"
              : "bg-transparent border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white"
          }`}
        >
          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${isLive ? "bg-[#00C805] animate-pulse" : "bg-gray-500"}`} />
          LIVE
        </Badge>
      </div>
    </div>
  )
}
