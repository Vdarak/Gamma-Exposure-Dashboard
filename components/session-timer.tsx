"use client"

import React, { useEffect, useState, useRef } from "react"
import { Play, Pause, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"

interface TimestampInfo {
  timestamp: string
  spotPrice: number
}

interface SessionTimerProps {
  ticker: string
  currentTimestamp: string | null
  onCheckpointChange: (timestamp: string | null, isLive: boolean) => void
  isLive: boolean
  onLiveChange: (live: boolean) => void
  onTimestampsLoad?: (timestamps: string[]) => void
}

export function SessionTimer({
  ticker,
  currentTimestamp,
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
      const res = await fetch(`/api/timestamps?ticker=${ticker}&days=1`)
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
          if (isLive || !currentTimestamp) {
            const latest = sorted[sorted.length - 1].timestamp
            onCheckpointChange(latest, isLive)
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
      fetch(`/api/timestamps?ticker=${ticker}&days=1`)
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
              if (latest !== currentTimestamp) {
                // Silently transition to latest in LIVE mode
                onCheckpointChange(latest, true)
              }
            }
          }
        })
        .catch(err => console.warn("Background checkpoint sync failed:", err))
    }, 60000)

    return () => clearInterval(interval)
  }, [ticker, isLive, currentTimestamp])

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
          
          const currentIndex = currentCheckpoints.findIndex(
            (c) => c.timestamp === currentTimestamp
          )
          
          let nextIndex = currentIndex + 1
          if (nextIndex >= currentCheckpoints.length || currentIndex === -1) {
            nextIndex = 0 // Loop back to start
          }
          
          const nextCheckpoint = currentCheckpoints[nextIndex].timestamp
          // Silent change
          onCheckpointChange(nextCheckpoint, false)
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
  }, [isPlaying, currentTimestamp, isLive])

  // Get index of current timestamp
  const currentIndex = checkpoints.findIndex((c) => c.timestamp === currentTimestamp)
  const displayIndex = currentIndex === -1 ? 0 : currentIndex

  const handleSliderChange = (values: number[]) => {
    setIsPlaying(false) // Pause playback on manual slider move
    if (isLive) {
      onLiveChange(false) // Turn off LIVE mode
    }
    const idx = values[0]
    if (checkpoints[idx]) {
      onCheckpointChange(checkpoints[idx].timestamp, false)
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
      onCheckpointChange(latest, true)
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
        <div className="flex flex-col text-left justify-center min-w-[150px]">
          <span className="text-[11px] text-gray-500 font-medium tracking-wide uppercase">
            Checkpoint Time
          </span>
          <span className="text-sm font-semibold text-white font-mono">
            {formatNYTime(currentTimestamp)}
            <span className="text-gray-500 text-xs font-normal ml-2 font-sans">
              ({checkpoints.length > 0 ? displayIndex + 1 : 0} / {checkpoints.length})
            </span>
          </span>
        </div>
      </div>

      <div className="flex-1 w-full flex items-center px-2">
        <Slider
          min={0}
          max={Math.max(0, checkpoints.length - 1)}
          step={1}
          value={[displayIndex]}
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
