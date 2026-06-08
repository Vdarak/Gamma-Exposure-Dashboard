"use client"

import { useMemo, useState } from "react"
import { colors } from "@/lib/design-tokens"

// ─── Types ────────────────────────────────────────────────────────

export type ExpiryMode = '90d' | '0dte' | 'custom'

interface ExpirySelectorProps {
  /** All available expiry date strings (sorted, YYYY-MM-DD) */
  availableExpiries: string[]
  /** Currently selected expiry mode */
  mode: ExpiryMode
  /** Callback when mode changes */
  onModeChange: (mode: ExpiryMode) => void
  /** Currently selected expiries in custom mode */
  selectedExpiries: string[]
  /** Callback when selected expiries change */
  onSelectedExpiriesChange: (expiries: string[]) => void
}

// ─── Component ────────────────────────────────────────────────────

export function ExpirySelector({
  availableExpiries,
  mode,
  onModeChange,
  selectedExpiries,
  onSelectedExpiriesChange,
}: ExpirySelectorProps) {
  const [customExpanded, setCustomExpanded] = useState(false)

  // Compute DTE for each expiry
  const expiriesWithDTE = useMemo(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return availableExpiries.map(exp => {
      const expDate = new Date(exp + "T00:00:00Z")
      const dte = Math.max(0, Math.ceil((expDate.getTime() - now.getTime()) / 86400000))
      return { date: exp, dte }
    })
  }, [availableExpiries])

  // Determine which expiries are "active" based on mode
  const activeExpiries = useMemo(() => {
    if (mode === '90d') {
      return expiriesWithDTE.filter(e => e.dte <= 90).map(e => e.date)
    }
    if (mode === '0dte') {
      // Today's expiry, or nearest if none today
      const today = expiriesWithDTE.find(e => e.dte === 0)
      if (today) return [today.date]
      const nearest = expiriesWithDTE[0]
      return nearest ? [nearest.date] : []
    }
    // Custom mode — use selectedExpiries
    return selectedExpiries
  }, [mode, expiriesWithDTE, selectedExpiries])

  const isSelected = (exp: string) => activeExpiries.includes(exp)

  const toggleExpiry = (exp: string) => {
    if (mode !== 'custom') return
    const next = isSelected(exp)
      ? selectedExpiries.filter(e => e !== exp)
      : [...selectedExpiries, exp].sort()
    onSelectedExpiriesChange(next)
  }

  const selectAll = () => {
    if (mode !== 'custom') return
    onSelectedExpiriesChange([...availableExpiries])
  }

  const clearAll = () => {
    if (mode !== 'custom') return
    onSelectedExpiriesChange([])
  }

  const handleModeChange = (newMode: ExpiryMode) => {
    onModeChange(newMode)
    if (newMode === 'custom' && selectedExpiries.length === 0) {
      // Pre-select 90d expiries as starting point
      const preset = expiriesWithDTE.filter(e => e.dte <= 90).map(e => e.date)
      onSelectedExpiriesChange(preset)
    }
    if (newMode === 'custom') {
      setCustomExpanded(true)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Mode toggles */}
      <div className="flex items-center gap-1">
        <span className="text-xxs text-[#525252] uppercase mr-1.5 font-medium tracking-wider">EXPIRY</span>
        {(['90d', '0dte', 'custom'] as ExpiryMode[]).map(m => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            className={`px-2.5 py-1 rounded text-xxs font-mono border transition-all ${
              mode === m
                ? 'bg-[#1A1A1A] text-[#E5E5E5] border-[#333]'
                : 'bg-transparent text-[#525252] border-[#1A1A1A] hover:border-[#333] hover:text-[#737373]'
            }`}
          >
            {m === '90d' ? '90D' : m === '0dte' ? '0DTE' : 'CUSTOM'}
          </button>
        ))}

        {/* Active count badge */}
        <span className="ml-1.5 text-xxs font-mono text-[#525252]">
          {activeExpiries.length}/{availableExpiries.length}
        </span>
      </div>

      {/* Custom mode: expiry list */}
      {mode === 'custom' && (
        <div className="flex flex-col gap-1.5">
          {/* Quick actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCustomExpanded(!customExpanded)}
              className="text-xxs font-mono text-[#525252] hover:text-[#E5E5E5] transition-colors"
            >
              {customExpanded ? '▼ HIDE LIST' : '▶ SHOW LIST'}
            </button>
            <button
              onClick={selectAll}
              className="text-xxs font-mono text-terminal-green/60 hover:text-terminal-green transition-colors"
            >
              +ALL
            </button>
            <button
              onClick={clearAll}
              className="text-xxs font-mono text-terminal-red/60 hover:text-terminal-red transition-colors"
            >
              −ALL
            </button>
          </div>

          {/* Selected pills (always visible) */}
          {selectedExpiries.length > 0 && selectedExpiries.length <= 8 && (
            <div className="flex flex-wrap gap-1">
              {selectedExpiries.map(exp => {
                const info = expiriesWithDTE.find(e => e.date === exp)
                return (
                  <span
                    key={exp}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1A1A1A] border border-[#2A2A2A] text-xxs font-mono text-[#E5E5E5]"
                  >
                    {exp.slice(5)}
                    <span className="text-[#525252]">{info ? `${info.dte}d` : ''}</span>
                    <button
                      onClick={() => toggleExpiry(exp)}
                      className="text-terminal-red/60 hover:text-terminal-red ml-0.5 transition-colors"
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {selectedExpiries.length > 8 && (
            <span className="text-xxs font-mono text-[#525252]">
              {selectedExpiries.length} expiries selected
            </span>
          )}

          {/* Full list */}
          {customExpanded && (
            <div className="max-h-48 overflow-y-auto border border-[#1A1A1A] rounded bg-[#080808] p-1.5 terminal-scrollbar">
              {expiriesWithDTE.map(({ date, dte }) => {
                const selected = isSelected(date)
                return (
                  <div
                    key={date}
                    className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors ${
                      selected
                        ? 'bg-[#1A1A1A] text-[#E5E5E5]'
                        : 'text-[#525252] hover:bg-[#111] hover:text-[#737373]'
                    }`}
                    onClick={() => toggleExpiry(date)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xxs font-mono">{date}</span>
                      <span className="text-xxs font-mono text-[#525252]">
                        {dte === 0 ? '0DTE' : `${dte}d`}
                      </span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpiry(date) }}
                      className={`w-5 h-5 flex items-center justify-center rounded text-xs font-mono border transition-all ${
                        selected
                          ? 'border-terminal-red/30 text-terminal-red hover:bg-terminal-red/10'
                          : 'border-terminal-green/30 text-terminal-green hover:bg-terminal-green/10'
                      }`}
                    >
                      {selected ? '−' : '+'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
