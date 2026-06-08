"use client"

import { useState } from "react"
import { colors } from "@/lib/design-tokens"

interface TerminalHeaderProps {
  ticker: string
  spotPrice: number | null
  totalGEX: number
  market: 'USA' | 'INDIA'
  lastUpdated: Date | null
  tickers: string[]
  customTickers: string[]
  onTickerSelect: (ticker: string) => void
  onMarketChange: (market: 'USA' | 'INDIA') => void
  onAddTicker: (ticker: string) => void
  onRemoveTicker: (ticker: string) => void
  onRefresh: () => void
}

export function TerminalHeader({
  ticker,
  spotPrice,
  totalGEX,
  market,
  lastUpdated,
  tickers,
  customTickers,
  onTickerSelect,
  onMarketChange,
  onAddTicker,
  onRemoveTicker,
  onRefresh,
}: TerminalHeaderProps) {
  const [showInput, setShowInput] = useState(false)
  const [inputValue, setInputValue] = useState("")

  const allTickers = [...tickers, ...customTickers]
  const currencySymbol = market === 'INDIA' ? '₹' : '$'

  const handleAddTicker = () => {
    const val = inputValue.trim().toUpperCase()
    if (val && !allTickers.includes(val)) {
      onAddTicker(val)
    }
    setInputValue("")
    setShowInput(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddTicker()
    if (e.key === "Escape") { setShowInput(false); setInputValue("") }
  }

  const formatTimestamp = (date: Date | null) => {
    if (!date) return "—"
    return date.toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <header className="border-b border-[#1A1A1A] bg-black">
      {/* Top accent line */}
      <div className="h-[2px] bg-gradient-to-r from-terminal-green/60 via-terminal-cyan/30 to-transparent" />

      <div className="px-4 lg:px-6 py-3">
        {/* Row 1: Brand + Market + Tickers */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-5">
            {/* Brand */}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-terminal-green animate-terminal-pulse" />
              <span className="text-sm font-semibold tracking-wide text-[#E5E5E5]">
                GEX TERMINAL
              </span>
            </div>

            {/* Market toggle */}
            <div className="flex items-center gap-1 rounded bg-[#0A0A0A] border border-[#1A1A1A] p-0.5">
              <button
                onClick={() => onMarketChange('USA')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${
                  market === 'USA'
                    ? 'bg-[#1A1A1A] text-[#E5E5E5]'
                    : 'text-[#525252] hover:text-[#737373]'
                }`}
              >
                USA
              </button>
              <button
                onClick={() => onMarketChange('INDIA')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${
                  market === 'INDIA'
                    ? 'bg-[#1A1A1A] text-[#E5E5E5]'
                    : 'text-[#525252] hover:text-[#737373]'
                }`}
              >
                INDIA
              </button>
            </div>

            {/* Ticker pills */}
            <div className="flex items-center gap-1">
              {allTickers.map((t) => (
                <button
                  key={t}
                  onClick={() => onTickerSelect(t)}
                  className={`group relative px-2.5 py-1 text-xs font-mono font-medium rounded transition-all ${
                    t === ticker
                      ? 'bg-[#1A1A1A] text-terminal-green border border-terminal-green/30'
                      : 'text-[#525252] hover:text-[#737373] border border-transparent'
                  }`}
                >
                  {t}
                  {customTickers.includes(t) && (
                    <span
                      onClick={(e) => { e.stopPropagation(); onRemoveTicker(t) }}
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#1A1A1A] border border-[#333] text-[#525252] hover:text-terminal-red hover:border-terminal-red/30 flex items-center justify-center text-[8px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      ×
                    </span>
                  )}
                </button>
              ))}

              {showInput ? (
                <input
                  autoFocus
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={() => { setShowInput(false); setInputValue("") }}
                  placeholder="TICK"
                  className="w-16 px-2 py-1 text-xs font-mono bg-[#0A0A0A] border border-[#333] rounded text-[#E5E5E5] placeholder-[#333] outline-none focus:border-terminal-green/50"
                />
              ) : (
                <button
                  onClick={() => setShowInput(true)}
                  className="px-1.5 py-1 text-xs text-[#333] hover:text-[#525252] transition-colors"
                  title="Add custom ticker"
                >
                  +
                </button>
              )}
            </div>
          </div>

          {/* Refresh */}
          <button
            onClick={onRefresh}
            className="px-2.5 py-1 text-xs text-[#525252] hover:text-[#E5E5E5] border border-[#1A1A1A] hover:border-[#333] rounded transition-all font-mono"
            title="Refresh data"
          >
            ⟳
          </button>
        </div>

        {/* Row 2: Key metrics bar */}
        {spotPrice !== null && (
          <div className="flex items-center gap-6 mt-2.5 pt-2.5 border-t border-[#111]">
            {/* Ticker + Spot */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#525252] font-medium">SPOT</span>
              <span className="font-mono text-sm font-semibold text-[#E5E5E5]">
                {currencySymbol}{spotPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            {/* Separator */}
            <div className="w-px h-4 bg-[#1A1A1A]" />

            {/* Total GEX */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#525252] font-medium">GEX</span>
              <span className={`font-mono text-sm font-semibold ${totalGEX >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                {totalGEX >= 0 ? '+' : ''}{totalGEX.toFixed(4)}B
              </span>
            </div>

            {/* Separator */}
            <div className="w-px h-4 bg-[#1A1A1A]" />

            {/* Market indicator */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#525252] font-medium">MKT</span>
              <span className="font-mono text-xs text-[#737373]">
                {market === 'USA' ? 'CBOE' : 'NSE'}
              </span>
            </div>

            {/* Push timestamp to right */}
            <div className="flex-1" />

            {/* Timestamp */}
            <span className="text-xxs text-[#525252] font-mono">
              {formatTimestamp(lastUpdated)}
              {lastUpdated && <span className="text-[#333]"> (15m delay)</span>}
            </span>
          </div>
        )}
      </div>
    </header>
  )
}
