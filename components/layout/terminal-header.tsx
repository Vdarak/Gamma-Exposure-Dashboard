"use client"

import { useState, useMemo } from "react"
import { colors } from "@/lib/design-tokens"

interface TerminalHeaderProps {
  ticker: string
  spotPrice: number | null
  market: 'USA' | 'INDIA'
  lastUpdated: Date | null
  onTickerSelect: (ticker: string) => void
  onMarketChange: (market: 'USA' | 'INDIA') => void
  onRefresh: () => void
}

export function TerminalHeader({
  ticker,
  spotPrice,
  market,
  lastUpdated,
  onTickerSelect,
  onMarketChange,
  onRefresh,
}: TerminalHeaderProps) {
  const [showInput, setShowInput] = useState(false)
  const [inputValue, setInputValue] = useState("")

  const currencySymbol = market === 'INDIA' ? '₹' : '$'

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const val = inputValue.trim().toUpperCase()
    if (val) {
      onTickerSelect(val)
    }
    setInputValue("")
    setShowInput(false)
  }

  // Consistent mock price change based on ticker name and price
  const priceChange = useMemo(() => {
    if (!spotPrice) return { value: 0, pct: 0 }
    const charCodeSum = ticker.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
    const isNegative = charCodeSum % 2 === 0
    const pct = 0.2 + ((charCodeSum % 220) / 100)
    const signedPct = pct * (isNegative ? -1 : 1)
    const value = spotPrice * (signedPct / 100)
    return {
      value,
      pct: signedPct
    }
  }, [ticker, spotPrice])

  const formatTimestamp = (date: Date | null) => {
    if (!date) return "—"
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const isUp = priceChange.pct >= 0

  return (
    <header className="border-b border-[#1A1A1E] bg-[#070709] px-4 py-2.5 flex items-center justify-between select-none">
      {/* Left section: Logo + Ticker search */}
      <div className="flex items-center gap-3">
        {/* Rounded red logo badge */}
        <div className="w-8 h-8 rounded-lg bg-[#E11D48] flex items-center justify-center font-bold text-sm text-white shadow-md shadow-rose-900/10">
          500
        </div>

        {/* Ticker Name */}
        <span className="text-lg font-extrabold tracking-tight text-white font-mono uppercase">
          ^{ticker}
        </span>

        {/* Search button/input */}
        <form onSubmit={handleSearchSubmit} className="relative flex items-center">
          {showInput ? (
            <input
              autoFocus
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onBlur={() => {
                if (!inputValue) setShowInput(false)
              }}
              placeholder="SEARCH..."
              className="h-7 w-28 px-2 text-xs font-mono bg-black border border-[#2A2A35] rounded text-white placeholder-[#444] outline-none focus:border-terminal-green/50"
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowInput(true)}
              className="w-7 h-7 flex items-center justify-center rounded border border-[#1A1A1E] bg-black/40 hover:bg-[#1A1A1E] transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-[#525252] hover:text-[#888]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          )}
        </form>
      </div>

      {/* Middle section: Metric blocks */}
      {spotPrice !== null && (
        <div className="flex items-center gap-2.5">
          {/* Last Price Metric */}
          <div className="bg-[#121215] border border-[#222] rounded px-3 py-1 flex items-baseline gap-1.5 h-8">
            <span className="text-[9px] text-[#525252] font-mono uppercase font-bold tracking-wider">LAST PRICE</span>
            <span className="text-xs font-bold font-mono text-[#E5E5E5]">
              {currencySymbol}{spotPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Price Change Metric */}
          <div className={`border rounded px-3 py-1 flex items-baseline gap-1.5 h-8 transition-colors ${
            isUp
              ? 'bg-[#0E1B15] border-terminal-green/20'
              : 'bg-[#1E0E10] border-terminal-red/20'
          }`}>
            <span className="text-[9px] text-[#525252] font-mono uppercase font-bold tracking-wider">CHANGE</span>
            <span className={`text-xs font-bold font-mono ${isUp ? 'text-[#00FF88]' : 'text-[#FF3B3B]'}`}>
              {isUp ? '+' : ''}{priceChange.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({isUp ? '+' : ''}{priceChange.pct.toFixed(2)}%)
            </span>
          </div>
        </div>
      )}

      {/* Right section: Market info & controls */}
      <div className="flex items-center gap-3">
        {/* Timestamp */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#1A1A1E] bg-black/20 text-[10px] font-mono text-[#525252]">
          <span>{market}</span>
          <span className="w-1 h-1 rounded-full bg-[#333]" />
          <span>{formatTimestamp(lastUpdated)}</span>
        </div>

        {/* Market selector (USA/INDIA) */}
        <div className="flex items-center gap-0.5 rounded bg-black border border-[#1A1A1E] p-0.5">
          <button
            onClick={() => onMarketChange('USA')}
            className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all ${
              market === 'USA' ? 'bg-[#1A1A1E] text-terminal-green' : 'text-[#525252]'
            }`}
          >
            USA
          </button>
          <button
            onClick={() => onMarketChange('INDIA')}
            className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all ${
              market === 'INDIA' ? 'bg-[#1A1A1E] text-terminal-green' : 'text-[#525252]'
            }`}
          >
            IND
          </button>
        </div>

        {/* Refresh button */}
        <button
          onClick={onRefresh}
          className="w-7 h-7 flex items-center justify-center rounded border border-[#1A1A1E] bg-black/40 hover:bg-[#1A1A1E] hover:border-[#333] text-[#525252] hover:text-[#E5E5E5] transition-all"
        >
          ⟳
        </button>
      </div>
    </header>
  )
}
