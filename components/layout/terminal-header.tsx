"use client"

import { useState, useMemo } from "react"
import { Bot, ChevronDown } from "lucide-react"
import { colors } from "@/lib/design-tokens"
import type { OptionData } from "@/lib/types"

// ─── Minimal arc gauge for terminal header ───────────────────────────

interface GaugeProps {
  value: number
  min: number
  max: number
  label: string
  unit?: string
  color: string        // e.g. '#00FF88'
  colorMuted: string   // e.g. 'rgba(0, 255, 136, 0.12)'
}

function TerminalGauge({ value, min, max, label, unit = '', color, colorMuted }: GaugeProps) {
  const normalized = Math.max(0, Math.min(1, (value - min) / (max - min || 1)))
  const sweepAngle = 180
  const startAngle = 180  // left
  const endAngle = startAngle + sweepAngle * normalized

  // SVG arc path
  const radius = 28
  const cx = 34
  const cy = 34
  const strokeWidth = 3

  const polarToCartesian = (angle: number) => {
    const rad = (angle * Math.PI) / 180
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    }
  }

  const trackStart = polarToCartesian(180)
  const trackEnd = polarToCartesian(360)
  const arcEnd = polarToCartesian(endAngle)
  const trackPath = `M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 0 1 ${trackEnd.x} ${trackEnd.y}`
  const valuePath = normalized > 0.01
    ? `M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 0 1 ${arcEnd.x} ${arcEnd.y}`
    : ''

  // Needle
  const needleAngle = 180 + sweepAngle * normalized
  const needleRad = (needleAngle * Math.PI) / 180
  const needleLen = radius - 6
  const needleEnd = {
    x: cx + needleLen * Math.cos(needleRad),
    y: cy + needleLen * Math.sin(needleRad),
  }

  const formatValue = (v: number) => {
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`
    return v.toFixed(1)
  }

  return (
    <div className="flex items-center gap-2 px-1 py-0.5 h-10 select-none">
      <svg width="68" height="38" viewBox="0 0 68 38" className="overflow-visible flex-shrink-0">
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="#1A1A1A"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Value arc */}
        {valuePath && (
          <path
            d={valuePath}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 3px ${color}30)` }}
          />
        )}
        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needleEnd.x}
          y2={needleEnd.y}
          stroke={color}
          strokeWidth={1.2}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 2px ${color}50)` }}
        />
        {/* Center dot */}
        <circle cx={cx} cy={cy} r={1.5} fill={color} />
      </svg>

      <div className="flex flex-col justify-center select-none min-w-[52px]">
        <span className="text-[8px] text-[#888] font-mono uppercase font-bold tracking-tight leading-none">{label}</span>
        <span className="font-mono text-[11px] font-extrabold mt-0.5 leading-none" style={{ color }}>
          {formatValue(value)}{unit}
        </span>
      </div>
    </div>
  )
}

// ─── Format Helpers ──────────────────────────────────────────────────

function formatLargeNumber(n: number): string {
  const abs = Math.abs(n)
  const sign = n >= 0 ? '+' : '-'
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`
  return `${sign}${abs.toFixed(0)}`
}

// ─── Terminal Header ──────────────────────────────────────────────────

interface TerminalHeaderProps {
  ticker: string
  spotPrice: number | null
  market: 'USA' | 'INDIA'
  lastUpdated: Date | null
  onTickerSelect: (ticker: string) => void
  onMarketChange: (market: 'USA' | 'INDIA') => void
  onRefresh: () => void
  totalGEX?: number
  optionData?: OptionData[]
  gammaFlipLevel?: number | null
  isAIPanelOpen?: boolean
  onToggleAIPanel?: () => void
  watchlist?: Array<{ ticker: string; price: number | null; pct: number | null }>
}

export function TerminalHeader({
  ticker,
  spotPrice,
  market,
  lastUpdated,
  onTickerSelect,
  onMarketChange,
  onRefresh,
  totalGEX,
  optionData,
  gammaFlipLevel,
  isAIPanelOpen = false,
  onToggleAIPanel,
  watchlist,
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

  // Real price changes are not present in raw option snapshot data (avoid mock data)
  const priceChange = useMemo(() => {
    return null
  }, [])

  // Compute aggregate stats for GEX if optionData is provided
  const stats = useMemo(() => {
    if (!optionData || optionData.length === 0) {
      return { totalGamma: 0, netGamma: 0, gexWeightedVol: 0 }
    }
    let totalGamma = 0
    let netGamma = 0
    let weightedIV = 0
    let totalAbsGEX = 0

    optionData.forEach((opt) => {
      const gamma = opt.gamma || 0
      const oi = opt.open_interest || 0
      const gexValue = opt.GEX_BS || opt.GEX || gamma * oi * 100
      const absGEX = Math.abs(gexValue)

      totalGamma += gamma * oi * 100
      netGamma += opt.type === 'C' ? gamma * oi * 100 : -(gamma * oi * 100)
      weightedIV += (opt.iv || 0) * absGEX
      totalAbsGEX += absGEX
    })

    const gexWeightedVol = totalAbsGEX > 0 ? (weightedIV / totalAbsGEX) * 100 : 0

    return { totalGamma, netGamma, gexWeightedVol }
  }, [optionData])

  const formatTimestamp = (date: Date | null) => {
    if (!date) return "—"
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const isUp = priceChange ? (priceChange as any).pct >= 0 : true

  // Dynamic gauge ranges
  const gexMax = Math.max(Math.abs(totalGEX || 0) * 2, 0.5)
  const volMax = Math.max(stats.gexWeightedVol * 1.5, 50)

  return (
    <header className="border-b border-[#1A1A1E] bg-[#070709] px-4 py-2.5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 select-none min-h-14">
      {/* Left section: Ticker search and hoverable watchlist */}
      <div className="flex items-center gap-3 flex-shrink-0 relative group">
        {/* Ticker Name with hoverable dropdown */}
        <div className="relative py-1 cursor-pointer">
          <span className="text-lg font-black tracking-tight text-terminal-green font-mono uppercase flex-shrink-0 hover:text-white transition-colors flex items-center gap-1">
            ^{ticker}
            <ChevronDown className="w-3.5 h-3.5 text-[#555] group-hover:text-terminal-green transition-colors" />
          </span>

          {/* Hover dropdown content */}
          {watchlist && watchlist.length > 0 && (
            <div className="absolute left-0 top-full mt-1.5 w-60 bg-[#0F0F12] border border-[#222]/90 rounded-md shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 p-2 select-text">
              <div className="text-[9px] font-mono text-[#555] uppercase tracking-wider mb-1.5 px-2 pb-1 border-b border-[#222]/40 font-bold">Watchlist</div>
              <div className="flex flex-col gap-1 max-h-[250px] overflow-y-auto pr-1 terminal-scrollbar">
                {watchlist.map((item) => {
                  const active = ticker === item.ticker
                  const isUp = item.pct !== null ? item.pct >= 0 : true
                  return (
                    <div
                      key={item.ticker}
                      onClick={() => onTickerSelect(item.ticker)}
                      className={`flex items-center justify-between p-2 rounded cursor-pointer transition-all duration-150 ${
                        active
                          ? 'bg-[#18181F] text-terminal-green border border-terminal-green/20'
                          : 'bg-transparent text-[#949494] hover:bg-[#121216] hover:text-white border border-transparent'
                      }`}
                    >
                      <span className="font-mono font-bold text-xs">{item.ticker}</span>
                      <div className="text-right font-mono">
                        <span className="text-xs font-semibold block text-[#E5E5E5]">
                          {item.price && item.price > 0 
                            ? `${currencySymbol}${item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : 'N/A'}
                        </span>
                        {item.pct !== null && (
                          <span className={`text-[9px] block font-bold ${isUp ? 'text-[#00C805]' : 'text-[#FF3B60]'}`}>
                            {isUp ? '+' : ''}{item.pct.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Search button/input */}
        <form onSubmit={handleSearchSubmit} className="relative flex items-center flex-shrink-0">
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
              <svg className="w-3.5 h-3.5 text-[#949494] hover:text-[#888]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          )}
        </form>
      </div>

      {/* Middle section: Integrated GEX Metrics & Micro-Gauges */}
      {spotPrice !== null && (
        <div className="flex items-center gap-4 flex-wrap lg:flex-nowrap justify-start lg:justify-center flex-1 py-1 lg:py-0">
          {/* Numeric stats row */}
          <div className="flex items-center gap-4 flex-wrap text-[11px] font-mono">
            {/* Spot Price */}
            <div className="flex flex-col justify-center">
              <span className="text-[8px] text-[#888] uppercase font-bold tracking-wider leading-none">SPOT PRICE</span>
              <div className="flex items-baseline gap-1.5 mt-1 leading-none">
                <span className="text-xs font-extrabold text-white">
                  {currencySymbol}{spotPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {priceChange && (
                  <span className={`text-[10px] font-bold ${isUp ? 'text-[#00C805]' : 'text-[#FF3B60]'}`}>
                    [{isUp ? '+' : ''}{(priceChange as any).value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({isUp ? '+' : ''}{(priceChange as any).pct.toFixed(2)}%)]
                  </span>
                )}
              </div>
            </div>

            <div className="hidden sm:block w-px h-6 bg-[#1A1A1E] self-center" />

            {/* Total GEX */}
            <div className="flex flex-col justify-center">
              <span className="text-[8px] text-[#888] uppercase font-bold tracking-wider leading-none">TOTAL GEX</span>
              <span className="text-xs font-extrabold mt-1 leading-none" style={{ color: totalGEX && totalGEX >= 0 ? '#00C805' : '#FF3B60' }}>
                {totalGEX !== undefined && totalGEX !== 0 ? `${totalGEX >= 0 ? '+' : ''}${totalGEX.toFixed(4)}B` : '—'}
              </span>
            </div>

            <div className="hidden sm:block w-px h-6 bg-[#1A1A1E] self-center" />

            {/* Total Gamma */}
            <div className="flex flex-col justify-center">
              <span className="text-[8px] text-[#888] uppercase font-bold tracking-wider leading-none">TOTAL GAMMA</span>
              <span className="text-xs font-extrabold text-[#E5E5E5] mt-1 leading-none">
                {stats.totalGamma !== 0 ? formatLargeNumber(stats.totalGamma) : '—'}
              </span>
            </div>

            <div className="hidden sm:block w-px h-6 bg-[#1A1A1E] self-center" />

            {/* Net Gamma */}
            <div className="flex flex-col justify-center">
              <span className="text-[8px] text-[#888] uppercase font-bold tracking-wider leading-none">NET GAMMA</span>
              <span className="text-xs font-extrabold mt-1 leading-none" style={{ color: stats.netGamma >= 0 ? '#00C805' : '#FF3B60' }}>
                {stats.netGamma !== 0 ? formatLargeNumber(stats.netGamma) : '—'}
              </span>
            </div>

            <div className="hidden sm:block w-px h-6 bg-[#1A1A1E] self-center" />

            {/* Gamma Flip */}
            <div className="flex flex-col justify-center">
              <span className="text-[8px] text-[#888] uppercase font-bold tracking-wider leading-none">GAMMA FLIP</span>
              <span className="text-xs font-extrabold text-[#FF00AA] mt-1 leading-none">
                {gammaFlipLevel ? `${currencySymbol}${gammaFlipLevel.toFixed(0)}` : '—'}
              </span>
            </div>
          </div>

          {/* Gauges */}
          {optionData && optionData.length > 0 && totalGEX !== undefined && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="hidden lg:block w-px h-6 bg-[#1A1A1E] self-center mx-1" />
              <TerminalGauge
                value={totalGEX}
                min={-gexMax}
                max={gexMax}
                label="GEX Intensity"
                unit="B"
                color={totalGEX >= 0 ? '#00C805' : '#FF3B60'}
                colorMuted={totalGEX >= 0 ? 'rgba(0, 200, 5, 0.12)' : 'rgba(255, 59, 96, 0.12)'}
              />
              <TerminalGauge
                value={stats.gexWeightedVol}
                min={0}
                max={volMax}
                label="GEX Wtd Vol"
                color="#FF3B60"
                colorMuted="rgba(255, 59, 96, 0.12)"
              />
            </div>
          )}
        </div>
      )}

      {/* Right section: Market info & controls */}
      <div className="flex items-center gap-2.5 flex-shrink-0 ml-auto lg:ml-0">
        {/* Timestamp */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#1A1A1E] bg-black/20 text-[10px] font-mono text-[#949494]">
          <span>{market}</span>
          <span className="w-1 h-1 rounded-full bg-[#333]" />
          <span>{formatTimestamp(lastUpdated)}</span>
        </div>

        {/* Market selector (USA/INDIA) */}
        <div className="flex items-center gap-0.5 rounded bg-black border border-[#1A1A1E] p-0.5">
          <button
            onClick={() => onMarketChange('USA')}
            className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all ${
              market === 'USA' ? 'bg-[#1A1A1E] text-terminal-green' : 'text-[#949494]'
            }`}
          >
            USA
          </button>
          <button
            onClick={() => onMarketChange('INDIA')}
            className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all ${
              market === 'INDIA' ? 'bg-[#1A1A1E] text-terminal-green' : 'text-[#949494]'
            }`}
          >
            IND
          </button>
        </div>

        {/* AI Analyst toggle button */}
        {onToggleAIPanel && (
          <button
            onClick={onToggleAIPanel}
            title="AI Analyst"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-mono font-bold transition-all ${
              isAIPanelOpen
                ? 'bg-[#00E676]/10 border-[#00E676]/40 text-[#00E676] shadow-[0_0_8px_rgba(0,230,118,0.12)]'
                : 'border-[#1A1A1E] bg-black/40 text-[#949494] hover:text-[#E5E5E5] hover:border-[#333]'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">AI</span>
          </button>
        )}

        {/* Refresh button */}
        <button
          onClick={onRefresh}
          className="w-7 h-7 flex items-center justify-center rounded border border-[#1A1A1E] bg-black/40 hover:bg-[#1A1A1E] hover:border-[#333] text-[#949494] hover:text-[#E5E5E5] transition-all"
        >
          ⟳
        </button>
      </div>
    </header>
  )
}
