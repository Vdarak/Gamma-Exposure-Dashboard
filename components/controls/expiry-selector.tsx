"use client"

import { useMemo } from "react"
import type { OptionData } from "@/lib/types"

export type ExpiryMode = '90d' | '0dte' | 'opex' | 'custom'

export function getOpexDte(): number {
  const today = new Date()
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth()
  
  const getThirdFriday = (y: number, m: number) => {
    const d = new Date(Date.UTC(y, m, 1))
    const day = d.getUTCDay()
    let firstFriday = 1
    if (day !== 5) {
      firstFriday = 1 + (5 - day + 7) % 7
    }
    return new Date(Date.UTC(y, m, firstFriday + 14))
  }
  
  const thisMonthOpex = getThirdFriday(year, month)
  const compareToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const compareOpex = Date.UTC(thisMonthOpex.getUTCFullYear(), thisMonthOpex.getUTCMonth(), thisMonthOpex.getUTCDate())
  
  let targetOpex = thisMonthOpex
  if (compareToday > compareOpex) {
    const nextMonth = (month + 1) % 12
    const nextYear = month === 11 ? year + 1 : year
    targetOpex = getThirdFriday(nextYear, nextMonth)
  }
  
  const compareTargetOpex = Date.UTC(targetOpex.getUTCFullYear(), targetOpex.getUTCMonth(), targetOpex.getUTCDate())
  return Math.max(0, Math.round((compareTargetOpex - compareToday) / 86400000))
}

interface ExpirySelectorProps {
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

export function ExpirySelector({
  availableExpiries,
  mode,
  onModeChange,
  selectedExpiries,
  onSelectedExpiriesChange,
  optionData,
}: ExpirySelectorProps) {
  
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
        // Option GEX is stored with signs already, but we represent call/put buildups
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

      // Format a nice human readable weekday/date
      const formattedDate = expDate.toLocaleDateString('en-US', {
        weekday: 'short',
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

  // 3. Helpers to check if card is active
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
    // If not in custom mode, clicking automatically activates custom mode
    let nextExpiries = [...selectedExpiries]
    if (mode !== 'custom') {
      // Seed custom with currently active ones
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
      // Seed with 90d
      const presetList = expiriesWithStats.filter(e => e.dte <= 90).map(e => e.date)
      onSelectedExpiriesChange(presetList)
    }
  }

  const handleReset = () => {
    onModeChange('90d')
    onSelectedExpiriesChange([])
  }

  return (
    <div className="flex flex-col h-full bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-3 select-none">
      {/* Header Presets */}
      <div className="flex items-center justify-between border-b border-[#1A1A1E] pb-2.5 mb-3">
        <div className="flex items-center gap-1 bg-black p-0.5 rounded border border-[#1A1A1E]">
          <button
            onClick={() => handlePresetChange('90d')}
            className={`px-2 py-1 text-[10px] font-mono rounded transition-all ${
              mode === '90d'
                ? 'bg-[#1A1A1E] text-terminal-green'
                : 'text-[#949494] hover:text-[#888]'
            }`}
          >
            ALL
          </button>
          <button
            onClick={() => handlePresetChange('0dte')}
            className={`px-2 py-1 text-[10px] font-mono rounded transition-all ${
              mode === '0dte'
                ? 'bg-[#1A1A1E] text-terminal-green'
                : 'text-[#949494] hover:text-[#888]'
            }`}
          >
            0DTE
          </button>
          <button
            onClick={() => handlePresetChange('opex')}
            className={`px-2 py-1 text-[10px] font-mono rounded transition-all ${
              mode === 'opex'
                ? 'bg-[#1A1A1E] text-terminal-green'
                : 'text-[#949494] hover:text-[#888]'
            }`}
          >
            OPEX
          </button>
          <button
            onClick={() => handlePresetChange('custom')}
            className={`px-2.5 py-1 text-[10px] font-mono rounded transition-all ${
              mode === 'custom'
                ? 'bg-[#1A1A1E] text-terminal-green'
                : 'text-[#949494] hover:text-[#888]'
            }`}
          >
            CUSTOM
          </button>
        </div>
      </div>

      {/* Expiries List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 max-h-[380px] terminal-scrollbar">
        {expiriesWithStats.map(item => {
          const active = isSelected(item.date)
          return (
            <div
              key={item.date}
              className={`border rounded p-2 transition-all flex flex-col gap-1.5 cursor-pointer ${
                active
                  ? 'bg-[#121215] border-[#25252E] opacity-100'
                  : 'bg-[#060608] border-[#101014] opacity-40 hover:opacity-75'
              }`}
              onClick={() => toggleExpiry(item.date)}
            >
              {/* Card Header */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold font-mono text-[#E5E5E5]">
                  {item.dte === 0 ? '0 DTE' : `${item.dte} DTE`}
                </span>
                <span className="text-[9px] font-mono text-[#949494]">
                  {item.formattedDate}
                </span>
              </div>

              {/* Card Body */}
              <div className="flex items-center gap-1.5 mt-0.5">
                {/* Call GEX Buildup */}
                <div className="flex-1 bg-black/60 border border-terminal-green/20 rounded px-2 py-0.5 text-center">
                  <span className="text-[9px] font-mono text-[#00C805]">
                    {formatGexBuildup(item.callGex)}
                  </span>
                </div>

                {/* Put GEX Buildup */}
                <div className="flex-1 bg-black/60 border border-terminal-red/20 rounded px-2 py-0.5 text-center">
                  <span className="text-[9px] font-mono text-[#FF3B60]">
                    {formatGexBuildup(item.putGex)}
                  </span>
                </div>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleExpiry(item.date)
                  }}
                  className={`w-5 h-5 flex items-center justify-center rounded-full transition-all flex-shrink-0 ${
                    active
                      ? 'bg-terminal-red/10 border border-terminal-red/30 text-terminal-red hover:bg-terminal-red/20'
                      : 'bg-terminal-green/10 border border-terminal-green/30 text-terminal-green hover:bg-terminal-green/20'
                  }`}
                >
                  <span className="text-xs font-bold leading-none">
                    {active ? '−' : '+'}
                  </span>
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom Checkboxes and Reset */}
      <div className="border-t border-[#1A1A1E] pt-3.5 mt-3 flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            defaultChecked
            className="w-3 h-3 rounded bg-black border-[#1A1A1E] text-terminal-green focus:ring-0 focus:ring-offset-0"
          />
          <span className="text-[10px] font-mono text-[#949494] hover:text-[#B5B5B5] transition-colors">
            APPLY TO VOL
          </span>
        </label>

        <button
          onClick={handleReset}
          className="px-2 py-0.5 rounded text-[10px] font-mono border border-[#1A1A1E] text-[#949494] hover:text-[#E5E5E5] hover:border-[#333] transition-all"
        >
          RESET
        </button>
      </div>
    </div>
  )
}
