"use client"

import { useMemo, useRef, useEffect } from "react"
import type { OptionData } from "@/lib/types"
import { getOpexDte } from "./expiry-selector"

export type ExpiryMode = '90d' | '0dte' | 'opex' | 'custom'

interface HorizontalExpirySelectorProps {
  availableExpiries: string[]
  mode: ExpiryMode
  onModeChange: (mode: ExpiryMode) => void
  selectedExpiries: string[]
  onSelectedExpiriesChange: (expiries: string[]) => void
  optionData: OptionData[]
}

// Format number into compact millions/billions for buildup display
function formatGexBuildup(num: number): string {
  const absVal = Math.abs(num)
  const sign = num >= 0 ? '+' : '−'
  if (absVal >= 1000000000) {
    return `${sign}${(absVal / 1000000000).toFixed(1)}B`
  }
  if (absVal >= 1000000) {
    return `${sign}${(absVal / 1000000).toFixed(1)}M`
  }
  if (absVal >= 1000) {
    return `${sign}${(absVal / 1000).toFixed(0)}K`
  }
  return `${sign}${absVal.toFixed(0)}`
}

export function HorizontalExpirySelector({
  availableExpiries,
  mode,
  onModeChange,
  selectedExpiries,
  onSelectedExpiriesChange,
  optionData,
}: HorizontalExpirySelectorProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Map vertical wheel scroll to horizontal scrolling
  useEffect(() => {
    const el = listRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      // Check if vertical scrolling is happening, shift it to horizontal
      e.preventDefault()
      el.scrollLeft += e.deltaY * 0.8
    }

    el.addEventListener("wheel", handleWheel, { passive: false })
    return () => el.removeEventListener("wheel", handleWheel)
  }, [])

  // 1. Group GEX calls and puts by expiration date
  const gexByExp = useMemo(() => {
    const map = new Map<string, { call: number; put: number }>()
    optionData.forEach(opt => {
      const expStr = opt.expiration.toISOString().split("T")[0]
      const current = map.get(expStr) || { call: 0, put: 0 }
      const gexVal = opt.GEX || opt.GEX_BS || 0

      if (opt.type === 'C') {
        current.call += gexVal
      } else {
        current.put += gexVal
      }
      map.set(expStr, current)
    })
    return map
  }, [optionData])

  // 2. Parse calendar days and DTEs
  const expiriesWithStats = useMemo(() => {
    const getDTE = (expStr: string) => {
      const parts = expStr.split('-')
      const expUTC = Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
      const today = new Date()
      const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
      return Math.max(0, Math.round((expUTC - todayUTC) / 86400000))
    }

    return availableExpiries.map(exp => {
      const dte = getDTE(exp)
      const expDate = new Date(exp + "T00:00:00Z")
      const stats = gexByExp.get(exp) || { call: 0, put: 0 }

      const formattedDate = expDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC'
      })

      return {
        date: exp,
        formattedDate,
        dte,
        callGex: stats.call,
        putGex: stats.put,
      }
    })
  }, [availableExpiries, gexByExp])

  const isSelected = (exp: string) => {
    if (mode === '90d') {
      const info = expiriesWithStats.find(e => e.date === exp)
      return info ? info.dte <= 90 : false
    }
    if (mode === '0dte') {
      const today = expiriesWithStats.find(e => e.dte === 0)
      if (today) return exp === today.date
      return exp === availableExpiries[0]
    }
    if (mode === 'opex') {
      const opexDTE = getOpexDte()
      const info = expiriesWithStats.find(e => e.date === exp)
      return info ? info.dte >= 0 && info.dte <= opexDTE : false
    }
    return selectedExpiries.includes(exp)
  }

  const toggleExpiry = (exp: string) => {
    let nextExpiries = [...selectedExpiries]
    if (mode !== 'custom') {
      if (mode === '90d') {
        nextExpiries = expiriesWithStats.filter(e => e.dte <= 90).map(e => e.date)
      } else if (mode === '0dte') {
        const today = expiriesWithStats.find(e => e.dte === 0)
        nextExpiries = today ? [today.date] : (availableExpiries[0] ? [availableExpiries[0]] : [])
      } else if (mode === 'opex') {
        const opexDTE = getOpexDte()
        nextExpiries = expiriesWithStats.filter(e => e.dte >= 0 && e.dte <= opexDTE).map(e => e.date)
      }
      onModeChange('custom')
    }

    if (nextExpiries.includes(exp)) {
      nextExpiries = nextExpiries.filter(e => e !== exp)
    } else {
      nextExpiries = [...nextExpiries, exp].sort()
    }
    onSelectedExpiriesChange(nextExpiries)
  }

  const handlePresetChange = (preset: ExpiryMode) => {
    onModeChange(preset)
    if (preset === 'custom') {
      const presetList = expiriesWithStats.filter(e => e.dte <= 90).map(e => e.date)
      onSelectedExpiriesChange(presetList)
    }
  }

  return (
    <div className="flex items-center gap-2 w-full select-none overflow-hidden h-[80px]">
      {/* Preset Pill Buttons */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {(['90d', '0dte', 'opex', 'custom'] as ExpiryMode[]).map((p) => {
          const active = mode === p
          const label = p === '90d' ? 'ALL' : p.toUpperCase()
          return (
            <button
              key={p}
              onClick={() => handlePresetChange(p)}
              className={`flex-shrink-0 border rounded-md px-3.5 transition-all cursor-pointer flex flex-col justify-center items-center font-mono font-black text-[10px] tracking-wider h-[44px] min-w-[70px] select-none ${active
                  ? 'bg-terminal-green/10 border-terminal-green/50 text-terminal-green shadow-[0_0_8px_rgba(0,255,136,0.1)]'
                  : 'bg-black/30 border-[#141418] text-[#555] hover:border-[#222] hover:bg-black/50 hover:text-[#949494]'
                }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Divider line */}
      <div className="w-[1px] h-8 bg-[#1A1A1E] flex-shrink-0 mx-1" />

      {/* Horizontal Scrollable Date Pills */}
      <div
        ref={listRef}
        className="flex-1 flex items-center gap-1.5 overflow-x-auto overflow-y-hidden whitespace-nowrap scrollbar-none py-1 px-0.5 max-w-full h-full"
      >
        {expiriesWithStats.map((item) => {
          const active = isSelected(item.date)
          return (
            <div
              key={item.date}
              onClick={() => toggleExpiry(item.date)}
              className={`flex-shrink-0 border rounded-md px-3 py-1.5 transition-all cursor-pointer flex flex-col justify-between min-w-[110px] h-[44px] select-none ${active
                  ? 'bg-[#121215] border-terminal-green/45 text-white shadow-[0_0_8px_rgba(0,255,136,0.08)]'
                  : 'bg-black/30 border-[#141418] text-[#555] hover:border-[#222] hover:bg-black/50'
                }`}
            >
              {/* Row 1: DTE & Date next to each other */}
              <div className="flex items-baseline justify-between w-full">
                <span className={`text-[11px] font-black tracking-tight leading-none ${active ? 'text-terminal-green' : 'text-[#888]'}`}>
                  {item.dte === 0 ? '0 DTE' : `${item.dte} DTE`}
                </span>
                <span className="text-[9px] font-mono leading-none text-[#555]">
                  {item.formattedDate}
                </span>
              </div>
              {/* Row 2: GEX values at the extremes */}
              <div className="flex items-center justify-between w-full text-[8px] font-mono leading-none font-bold">
                <span className="text-[#00C805]">{formatGexBuildup(item.callGex)}</span>
                <span className="text-[#FF3B60]">{formatGexBuildup(item.putGex)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
