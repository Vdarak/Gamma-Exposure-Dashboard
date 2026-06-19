"use client"

import React, { useState, useMemo, useEffect, useCallback } from "react"
import { 
  ArrowUpDown, 
  HelpCircle, 
  Plus, 
  RefreshCw, 
  Eye, 
  Play, 
  Pause,
  ChevronDown,
  X,
  Sparkles,
  TrendingUp,
  AlertCircle
} from "lucide-react"
import { getOptionsFlowData, OptionFlowItem, FlowAggregates, JournalTrade } from "@/lib/backend-api"

interface OptionFlowDashboardProps {
  ticker: string
  onTickerSelect: (ticker: string) => void
  availableTickers: string[]
  onTradeLogged?: (trade: JournalTrade) => void
}

type PresetId = 'default' | 'gamma-pin' | 'short-term-bullish' | 'short-term-bearish' | 'vol-expansion' | 'bullish-reversal' | 'bullish-lotto'

interface PresetFilter {
  id: PresetId
  label: string
  filterFn: (item: OptionFlowItem) => boolean
}

type Timeframe = 'Intraday' | 'Daily' | '5-Day' | 'Custom'

export function OptionFlowDashboard({ ticker, onTickerSelect, availableTickers, onTradeLogged }: OptionFlowDashboardProps) {
  const [data, setData] = useState<OptionFlowItem[]>([])
  const [aggregates, setAggregates] = useState<FlowAggregates>({
    dominantSentiment: 'Neutral',
    bullishSentimentPercent: 50,
    putCallRatio: 1,
    callVolume: 0,
    putVolume: 0,
    callPremium: 0,
    putPremium: 0,
    callPercentage: 50,
    putPercentage: 50
  })
  const [topNotionalStrikes, setTopNotionalStrikes] = useState<OptionFlowItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [activePreset, setActivePreset] = useState<PresetId>('default')
  const [timeframe, setTimeframe] = useState<Timeframe>('Intraday')
  const [customStartDate, setCustomStartDate] = useState<string>(
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  )
  
  const [tickerSearchOpen, setTickerSearchOpen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(true)
  
  // Sorting state
  const [sortField, setSortField] = useState<keyof OptionFlowItem>('notionalChange')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  // Column Visibility state
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    time: true,
    ticker: true,
    expiry: true,
    strike: true,
    cp: true,
    spot: true,
    price: true,
    oiChange: true,
    notionalChange: true,
    timeframeType: true,
    volume: true,
    iv: true,
    delta: true,
    dte: true,
    earnings: true
  })
  
  const [showColumnConfig, setShowColumnConfig] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 50

  // Presets and filters
  const presets: PresetFilter[] = [
    { id: 'default', label: 'Default', filterFn: () => true },
    { id: 'gamma-pin', label: 'Gamma Pin', filterFn: (item) => item.dte <= 7 && item.delta >= 0.45 && item.delta <= 0.55 },
    { id: 'short-term-bullish', label: 'Short-Term Bullish', filterFn: (item) => item.optionType === 'Call' && item.dte <= 14 && item.delta >= 0.10 && item.delta <= 0.40 },
    { id: 'short-term-bearish', label: 'Short-Term Bearish', filterFn: (item) => item.optionType === 'Put' && item.dte <= 14 && item.delta >= 0.10 && item.delta <= 0.40 },
    { id: 'vol-expansion', label: 'Vol Expansion', filterFn: (item) => item.iv5dPointDiff !== null && item.iv5dPointDiff > 25 },
    { id: 'bullish-reversal', label: 'Bullish Reversal', filterFn: (item) => item.optionType === 'Call' && item.oi5dChangePercent !== null && item.oi5dChangePercent > 100 },
    { id: 'bullish-lotto', label: 'Bullish Lotto', filterFn: (item) => item.optionType === 'Call' && item.dte <= 3 && item.delta < 0.15 }
  ]

  // Data fetching
  const loadData = useCallback(async (currentTicker: string, currentTf: Timeframe, customDate?: string) => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await getOptionsFlowData(
        currentTicker, 
        currentTf, 
        currentTf === 'Custom' ? customDate : undefined
      )
      setData(response.data)
      setAggregates(response.aggregates)
      setTopNotionalStrikes(response.topNotionalStrikes)
    } catch (err) {
      console.error("Failed to load options flow:", err)
      setError("Failed to sync Options Flow data. Please ensure the backend server and database are running.")
      setData([])
      setTopNotionalStrikes([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial fetch and polling
  useEffect(() => {
    loadData(ticker, timeframe, customStartDate)
  }, [ticker, timeframe, customStartDate, loadData])

  useEffect(() => {
    if (!isPlaying) return
    
    const interval = setInterval(() => {
      loadData(ticker, timeframe, customStartDate)
    }, 15000) // Poll every 15s when active

    return () => clearInterval(interval)
  }, [ticker, timeframe, customStartDate, isPlaying, loadData])

  // Reset pagination on filter or ticker change
  useEffect(() => {
    setCurrentPage(1)
  }, [ticker, timeframe, activePreset, sortField, sortDirection])

  // Filter & Sort Pipeline
  const processedData = useMemo(() => {
    const preset = presets.find(p => p.id === activePreset)
    
    // Filter by selected ticker (case-insensitively)
    let filtered = data.filter(item => item.ticker.toUpperCase() === ticker.toUpperCase())

    // Filter by preset
    if (preset) {
      filtered = filtered.filter(preset.filterFn)
    }

    // Sort
    return [...filtered].sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      
      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      return sortDirection === 'asc' 
        ? (aVal as number) - (bVal as number) 
        : (bVal as number) - (aVal as number)
    })
  }, [data, activePreset, sortField, sortDirection, ticker])

  // Get max OI change in dataset for background visual sizing
  const maxOiChange = useMemo(() => {
    if (processedData.length === 0) return 1
    return processedData.reduce((max, d) => Math.max(max, Math.abs(d.oiChange ?? 0)), 1)
  }, [processedData])

  // Paginated dataset to keep DOM lightweight and prevent lagging
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return processedData.slice(startIndex, startIndex + itemsPerPage)
  }, [processedData, currentPage])

  const handleSort = (field: keyof OptionFlowItem) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const toggleColumn = (col: string) => {
    setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }))
  }

  const getTickerPrefix = (symbol: string) => {
    return symbol.slice(0, 2).toLowerCase()
  }

  const formatNotional = (val: number) => {
    const num = val ?? 0
    if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`
    if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`
    return `$${num.toFixed(0)}`
  }

  const formatLargeNumber = (val: number) => {
    const num = val ?? 0
    if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`
    if (num >= 1e3) return `${(num / 1e3).toFixed(0)}K`
    return num.toString()
  }

  return (
    <div className="flex flex-col lg:flex-row lg:h-full h-auto bg-[#050608] text-[#D1D4DC] font-sans antialiased border border-[#14161C] rounded-lg overflow-y-auto lg:overflow-hidden select-none">
      
      {/* LEFT COLUMN: Main Options Flow Terminal */}
      <div className="flex-1 flex flex-col min-w-0 lg:h-full border-b lg:border-b-0 lg:border-r border-[#14161C]">
        
        {/* HEADER CONTROLS */}
        <div className="flex flex-row items-center justify-between px-5 py-3 border-b border-[#13161C] bg-[#0A0C10] gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold font-mono tracking-tight text-white uppercase flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-[#00E676]" />
              <span>Strike OI Flows</span>
            </h1>
            
            {/* Timeframe selector buttons */}
            <div className="flex bg-[#0D1015] border border-[#20242D] rounded p-0.5 font-mono text-[10px]">
              {(['Intraday', 'Daily', '5-Day', 'Custom'] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2 py-0.5 rounded transition-all ${
                    timeframe === tf
                      ? 'bg-[#1C202E] text-white font-bold'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Custom Date Picker */}
            {timeframe === 'Custom' && (
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-[#0D1015] border border-[#20242D] rounded text-[10px] font-mono px-2 py-0.5 text-white focus:outline-none focus:border-[#00E676] max-w-[110px]"
              />
            )}
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2">
            {/* Search Dropdown */}
            <div className="relative">
              <button 
                onClick={() => setTickerSearchOpen(!tickerSearchOpen)}
                className="flex items-center justify-between w-[100px] h-8 px-2.5 bg-[#0D1015] border border-[#20242D] rounded text-xs font-mono hover:border-[#303644] transition-colors text-white"
              >
                <span>{ticker}</span>
                <ChevronDown className="w-3 h-3 text-gray-400" />
              </button>

              {tickerSearchOpen && (
                <div className="absolute right-0 mt-1 w-[100px] bg-[#0D1015] border border-[#20242D] rounded shadow-2xl z-50 py-1 font-mono text-xs max-h-40 overflow-y-auto">
                  {availableTickers.map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        onTickerSelect(t)
                        setTickerSearchOpen(false)
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-[#1A202C] text-gray-300 hover:text-white transition-colors"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Pause / Play */}
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              className="flex items-center justify-center w-8 h-8 bg-[#0D1015] border border-[#20242D] rounded hover:bg-[#1A202C] transition-colors"
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 text-[#00E676]" />
              ) : (
                <Play className="w-3.5 h-3.5 text-gray-400 hover:text-white" />
              )}
            </button>
          </div>
        </div>

        {/* TOP METRIC CARDS */}
        <div className="grid grid-cols-4 gap-3.5 p-4 border-b border-[#13161C] bg-[#07090C]">
          
          {/* CARD 1: Flow Sentiment */}
          <div className="bg-[#0D1015]/60 border border-[#14161D] rounded-lg p-3 flex flex-col justify-between min-h-[72px]">
            <span className="text-[10px] text-gray-400 font-mono tracking-wider uppercase">Flow Sentiment</span>
            <div className="flex items-center justify-between mt-1">
              <span className={`text-base font-bold font-mono ${
                aggregates.dominantSentiment === 'Bullish' ? 'text-[#00E676]' : 
                aggregates.dominantSentiment === 'Bearish' ? 'text-[#FF3860]' : 'text-gray-400'
              }`}>
                {aggregates.dominantSentiment}
              </span>
              <span className="text-xs text-gray-500 font-mono">
                {aggregates.bullishSentimentPercent.toFixed(1)}% Bull
              </span>
            </div>
            {/* Sentiment Progress Bar */}
            <div className="w-full bg-[#1A202C] h-1.5 rounded-full mt-2 overflow-hidden flex">
              <div 
                className="bg-[#00E676] h-full" 
                style={{ width: `${aggregates.bullishSentimentPercent}%` }}
              />
              <div 
                className="bg-[#FF3860] h-full flex-1" 
              />
            </div>
          </div>

          {/* CARD 2: Put to Call Ratio */}
          <div className="bg-[#0D1015]/60 border border-[#14161D] rounded-lg p-3 flex flex-col justify-between min-h-[72px]">
            <span className="text-[10px] text-gray-400 font-mono tracking-wider uppercase">Put to Call Ratio</span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-lg font-bold font-mono text-white">
                {aggregates.putCallRatio.toFixed(3)}
              </span>
              <span className="text-[9px] text-gray-500 font-mono">
                ({(aggregates.putCallRatio >= 1 ? 'Heavy Puts' : 'Heavy Calls')})
              </span>
            </div>
            <div className="flex items-center justify-between text-[9px] text-gray-500 font-mono mt-1">
              <span>{aggregates.callPercentage.toFixed(1)}% Calls</span>
              <span>{aggregates.putPercentage.toFixed(1)}% Puts</span>
            </div>
          </div>

          {/* CARD 3: Call Flow */}
          <div className="bg-[#0D1015]/60 border border-[#14161D] rounded-lg p-3 flex flex-col justify-between min-h-[72px]">
            <span className="text-[10px] text-[#00E676] font-mono tracking-wider uppercase flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00E676]" />
              Call Premium Flow
            </span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-lg font-bold font-mono text-white">
                {formatNotional(aggregates.callPremium)}
              </span>
              <span className="text-xs text-[#00E676] font-mono font-bold">
                {aggregates.callPercentage.toFixed(1)}% Vol
              </span>
            </div>
            <span className="text-[9px] text-gray-500 font-mono">
              Total volume: {formatLargeNumber(aggregates.callVolume)}
            </span>
          </div>

          {/* CARD 4: Put Flow */}
          <div className="bg-[#0D1015]/60 border border-[#14161D] rounded-lg p-3 flex flex-col justify-between min-h-[72px]">
            <span className="text-[10px] text-[#FF3860] font-mono tracking-wider uppercase flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[#FF3860]" />
              Put Premium Flow
            </span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-lg font-bold font-mono text-white">
                {formatNotional(aggregates.putPremium)}
              </span>
              <span className="text-xs text-[#FF3860] font-mono font-bold">
                {aggregates.putPercentage.toFixed(1)}% Vol
              </span>
            </div>
            <span className="text-[9px] text-gray-500 font-mono">
              Total volume: {formatLargeNumber(aggregates.putVolume)}
            </span>
          </div>
        </div>

        {/* TABS / PRESETS */}
        <div className="flex flex-row items-center gap-1.5 px-5 py-2.5 border-b border-[#13161C] bg-[#07090C] overflow-x-auto relative">
          {presets.map((preset) => {
            const active = activePreset === preset.id
            return (
              <button
                key={preset.id}
                onClick={() => setActivePreset(preset.id)}
                className={`px-3 py-1 rounded text-xs font-mono transition-all duration-150 border ${
                  active 
                    ? "bg-[#00E676]/10 text-[#00E676] border-[#00E676]/30 font-bold" 
                    : "bg-transparent text-gray-400 border-transparent hover:text-white hover:bg-[#1A202C]"
                }`}
              >
                {preset.label}
              </button>
            )
          })}

          {/* Action Tools */}
          <div className="ml-auto flex items-center gap-1">
            <button 
              onClick={() => loadData(ticker, timeframe, customStartDate)}
              className="p-1.5 bg-transparent text-gray-400 hover:text-white hover:bg-[#1A202C] rounded transition-all"
              title="Force refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            
            <div className="relative">
              <button 
                onClick={() => setShowColumnConfig(!showColumnConfig)}
                className="p-1.5 bg-transparent text-gray-400 hover:text-white hover:bg-[#1A202C] rounded transition-all"
                title="Toggle columns"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>

              {showColumnConfig && (
                <div className="absolute right-0 mt-1 w-48 bg-[#0D1015] border border-[#20242D] rounded shadow-2xl z-50 p-2 font-mono text-[10px] grid grid-cols-2 gap-1.5">
                  {Object.keys(visibleColumns).map((col) => (
                    <label key={col} className="flex items-center gap-1.5 text-gray-300 hover:text-white cursor-pointer capitalize">
                      <input 
                        type="checkbox" 
                        checked={visibleColumns[col]} 
                        onChange={() => toggleColumn(col)}
                        className="rounded border-[#20242D] bg-black text-[#00E676] focus:ring-0 w-3 h-3" 
                      />
                      <span>{col}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* DATA GRID */}
        <div className="flex-1 overflow-auto bg-[#050608]">
          {isLoading && data.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-xs font-mono text-gray-500 gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>SYNCING TERMINAL SNAPSHOTS...</span>
            </div>
          ) : error && data.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-xs font-mono text-red-400 p-4 text-center">
              <AlertCircle className="w-6 h-6 mb-2 text-red-500" />
              <span>{error}</span>
              <button onClick={() => loadData(ticker, timeframe, customStartDate)} className="mt-3 px-3 py-1 bg-red-500/10 border border-red-500/30 text-red-400 rounded hover:bg-red-500/20">
                RETRY CONNECTION
              </button>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead className="bg-[#0A0C10] sticky top-0 border-b border-[#14161C] text-gray-400 select-none z-10">
                <tr>
                  {visibleColumns.time && <th className="px-3 py-2 font-semibold text-gray-400">Time</th>}
                  {visibleColumns.ticker && <th className="px-3 py-2 font-semibold text-gray-400">Tick</th>}
                  {visibleColumns.expiry && <th className="px-3 py-2 font-semibold text-gray-400">Expiry</th>}
                  {visibleColumns.strike && <th className="px-3 py-2 font-semibold text-gray-400">Strike</th>}
                  {visibleColumns.cp && <th className="px-3 py-2 font-semibold text-gray-400">C/P</th>}
                  {visibleColumns.spot && <th className="px-3 py-2 font-semibold text-gray-400">Spot</th>}
                  {visibleColumns.price && <th className="px-3 py-2 font-semibold text-gray-400">Price</th>}
                  
                  {visibleColumns.oiChange && (
                    <th 
                      onClick={() => handleSort('oiChange')}
                      className="px-3 py-2 font-semibold text-gray-400 cursor-pointer hover:text-white transition-colors min-w-[120px]"
                    >
                      <div className="flex items-center gap-1">
                        <span>OI Δ</span>
                        <ArrowUpDown className="w-3 h-3 text-gray-500" />
                      </div>
                    </th>
                  )}

                  {visibleColumns.notionalChange && (
                    <th 
                      onClick={() => handleSort('notionalChange')}
                      className="px-3 py-2 font-semibold text-gray-400 cursor-pointer hover:text-white transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span>Notional Δ</span>
                        <ArrowUpDown className="w-3 h-3 text-gray-500" />
                      </div>
                    </th>
                  )}

                  {visibleColumns.timeframeType && <th className="px-3 py-2 font-semibold text-gray-400">Type</th>}
                  {visibleColumns.volume && <th className="px-3 py-2 font-semibold text-gray-400">Vol</th>}
                  {visibleColumns.iv && <th className="px-3 py-2 font-semibold text-gray-400">IV</th>}
                  {visibleColumns.delta && <th className="px-3 py-2 font-semibold text-gray-400">Delta</th>}
                  {visibleColumns.dte && <th className="px-3 py-2 font-semibold text-gray-400">DTE</th>}
                  {visibleColumns.earnings && <th className="px-3 py-2 font-semibold text-gray-400">Earnings</th>}
                </tr>
              </thead>

              <tbody className="divide-y divide-[#101217] bg-[#050608]">
                {processedData.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="text-center py-8 text-gray-500">
                      No options contracts match the active filters.
                    </td>
                  </tr>
                ) : (
                  paginatedData.map((row, idx) => {
                    const isCall = row.optionType === 'Call'
                    const isOiPositive = row.oiChange >= 0
                    
                    // Width of background fill bar
                    const barWidth = Math.min(100, (Math.abs(row.oiChange) / maxOiChange) * 100)
                    
                    return (
                      <tr key={`${row.id}-${idx}`} className="hover:bg-[#0E1117] transition-colors border-b border-[#0F1116] group">
                        {/* Time */}
                        {visibleColumns.time && (
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                            {row.time.split(' ')[1] || row.time}
                          </td>
                        )}

                        {/* Ticker Badging */}
                        {visibleColumns.ticker && (
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <div className="w-4 h-4 rounded-sm bg-[#0052FF] flex items-center justify-center text-[7px] text-white font-sans font-black select-none uppercase shrink-0">
                                {getTickerPrefix(row.ticker)}
                              </div>
                              <span className="text-white text-[10px] font-bold">
                                {row.ticker}
                              </span>
                            </div>
                          </td>
                        )}

                        {/* Expiry */}
                        {visibleColumns.expiry && (
                          <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                            {row.expiration}
                          </td>
                        )}

                        {/* Strike */}
                        {visibleColumns.strike && (
                          <td className="px-3 py-2 text-white font-semibold">
                            {(row.strike ?? 0).toFixed(1)}
                          </td>
                        )}

                        {/* C/P */}
                        {visibleColumns.cp && (
                          <td className={`px-3 py-2 font-bold ${isCall ? 'text-[#00E676]' : 'text-[#FF3860]'}`}>
                            {row.optionType}
                          </td>
                        )}

                        {/* Spot Price */}
                        {visibleColumns.spot && (
                          <td className="px-3 py-2 text-gray-400">
                            ${(row.stockPrice ?? 0).toFixed(2)}
                          </td>
                        )}

                        {/* Price */}
                        {visibleColumns.price && (
                          <td className="px-3 py-2 text-gray-300 font-semibold">
                            ${(row.lastPrice ?? 0).toFixed(2)}
                          </td>
                        )}

                        {/* OI Change with visual bar */}
                        {visibleColumns.oiChange && (
                          <td className="px-3 py-2 relative min-w-[120px] select-none">
                            <div 
                              className={`absolute inset-y-1 left-1 rounded-sm ${
                                isOiPositive ? 'bg-[#00E676]/10' : 'bg-[#FF3860]/10'
                              }`} 
                              style={{ width: `${barWidth}%` }}
                            />
                            <span className={`relative font-semibold ${isOiPositive ? 'text-[#00E676]' : 'text-[#FF3860]'}`}>
                              {isOiPositive ? '+' : ''}{(row.oiChange ?? 0).toLocaleString()}
                            </span>
                          </td>
                        )}

                        {/* Notional Change */}
                        {visibleColumns.notionalChange && (
                          <td className="px-3 py-2 text-white font-semibold">
                            {formatNotional(row.notionalChange)}
                          </td>
                        )}

                        {/* Timeframe Type */}
                        {visibleColumns.timeframeType && (
                          <td className="px-3 py-2 text-gray-500 font-mono text-[9px] uppercase">
                            {row.timeframeType}
                          </td>
                        )}

                        {/* Volume */}
                        {visibleColumns.volume && (
                          <td className="px-3 py-2 text-gray-300">
                            {(row.volume ?? 0).toLocaleString()}
                          </td>
                        )}

                        {/* IV */}
                        {visibleColumns.iv && (
                          <td className="px-3 py-2 text-gray-400">
                            {(row.ivPercent ?? 0).toFixed(1)}%
                          </td>
                        )}

                        {/* Delta */}
                        {visibleColumns.delta && (
                          <td className="px-3 py-2 text-gray-400">
                            {(row.delta ?? 0).toFixed(3)}
                          </td>
                        )}

                        {/* DTE */}
                        {visibleColumns.dte && (
                          <td className="px-3 py-2 text-gray-400">
                            {row.dte}d
                          </td>
                        )}

                        {/* Earnings */}
                        {visibleColumns.earnings && (
                          <td className="px-3 py-2 text-gray-500">
                            {row.earningsRemainingDays !== null ? `${row.earningsRemainingDays}d` : '--'}
                          </td>
                        )}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* PAGINATION CONTROLLER */}
        {processedData.length > itemsPerPage && (
          <div className="flex items-center justify-between px-5 py-2.5 border-t border-[#13161C] bg-[#0A0C10] font-mono text-[10px] text-gray-400 select-none shrink-0">
            <div>
              Showing <span className="text-white">{(currentPage - 1) * itemsPerPage + 1}</span> to{" "}
              <span className="text-white">
                {Math.min(currentPage * itemsPerPage, processedData.length)}
              </span>{" "}
              of <span className="text-white">{processedData.length}</span> strikes
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="px-2.5 py-1 bg-[#0D1015] border border-[#20242D] rounded text-white hover:bg-[#1C202E] disabled:opacity-40 disabled:hover:bg-[#0D1015] transition-colors"
              >
                PREV
              </button>
              <span className="px-2 py-1 bg-[#1C202E]/60 text-white border border-[#2B3045]/60 rounded">
                PAGE {currentPage} OF {Math.ceil(processedData.length / itemsPerPage)}
              </span>
              <button
                type="button"
                disabled={currentPage >= Math.ceil(processedData.length / itemsPerPage)}
                onClick={() => setCurrentPage(prev => Math.min(Math.ceil(processedData.length / itemsPerPage), prev + 1))}
                className="px-2.5 py-1 bg-[#0D1015] border border-[#20242D] rounded text-white hover:bg-[#1C202E] disabled:opacity-40 disabled:hover:bg-[#0D1015] transition-colors"
              >
                NEXT
              </button>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN SIDEBAR: Top 5 Notional Leaderboard */}
      <div className="w-full lg:w-[300px] border-t lg:border-t-0 lg:border-l border-[#13161C] bg-[#07090C] flex flex-col p-4 overflow-y-auto select-none shrink-0 lg:shrink-0 gap-4">
        <h2 className="text-[10px] font-bold font-mono text-gray-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-[#13161C] pb-2">
          <TrendingUp className="w-3.5 h-3.5 text-[#00E676]" />
          <span>Top 5 OI Strike Shifts</span>
        </h2>

        {topNotionalStrikes.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-xs font-mono italic">
            No shifts computed.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {topNotionalStrikes.map((strike, idx) => {
              const isCall = strike.optionType === 'Call'
              const isOiPositive = strike.oiChange >= 0
              
              return (
                <div 
                  key={`${strike.id}-${idx}`}
                  className={`bg-[#0D1015]/60 hover:bg-[#0D1015] border border-[#14161D] rounded-lg p-3 relative overflow-hidden transition-all flex flex-col gap-2 ${
                    isCall ? 'border-l-4 border-l-[#00E676]' : 'border-l-4 border-l-[#FF3860]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400 font-mono font-bold">
                      {strike.ticker} • {strike.expiration}
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono">
                      #{idx + 1}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-bold text-white font-mono">
                      {(strike.strike ?? 0).toFixed(1)} {strike.optionType}
                    </span>
                    <span className="text-xs font-semibold text-white font-mono">
                      {formatNotional(strike.notionalChange ?? 0)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[10px] font-mono border-t border-[#101217] pt-1.5 mt-0.5">
                    <span className={isOiPositive ? 'text-[#00E676]' : 'text-[#FF3860]'}>
                      OI Δ: {isOiPositive ? '+' : ''}{(strike.oiChange ?? 0).toLocaleString()}
                    </span>
                    <span className="text-gray-400">
                      Price: ${(strike.lastPrice ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
