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
  X 
} from "lucide-react"
import { getOptionsFlowData, OptionFlowItem } from "@/lib/backend-api"

interface OptionFlowDashboardProps {
  ticker: string
  onTickerSelect: (ticker: string) => void
  availableTickers: string[]
}

type PresetId = 'default' | 'gamma-pin' | 'short-term-bullish' | 'short-term-bearish' | 'vol-expansion' | 'bullish-reversal' | 'bullish-lotto'

interface PresetFilter {
  id: PresetId
  label: string
  filterFn: (item: OptionFlowItem) => boolean
}

export function OptionFlowDashboard({ ticker, onTickerSelect, availableTickers }: OptionFlowDashboardProps) {
  const [data, setData] = useState<OptionFlowItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [activePreset, setActivePreset] = useState<PresetId>('short-term-bullish')
  const [tickerSearchOpen, setTickerSearchOpen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(true)
  
  // Sorting state
  const [sortField, setSortField] = useState<keyof OptionFlowItem>('changePercent')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  // Column Visibility state
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    time: true,
    ticker: true,
    contract: true,
    stock: true,
    last: true,
    change: true,
    volume: true,
    oi: true,
    oi5d: true,
    otm: true,
    iv: true,
    iv5d: true,
    delta: true,
    dte: true,
    earnings: true
  })
  
  const [showColumnConfig, setShowColumnConfig] = useState(false)

  // Presets and filters matching the requirements
  const presets: PresetFilter[] = [
    { id: 'default', label: 'Default', filterFn: () => true },
    { id: 'gamma-pin', label: 'Gamma Pin', filterFn: (item) => item.dte <= 7 && item.delta >= 0.45 && item.delta <= 0.55 },
    { id: 'short-term-bullish', label: 'Short-Term Bullish', filterFn: (item) => item.optionType === 'Call' && item.dte <= 14 && item.delta >= 0.10 && item.delta <= 0.40 },
    { id: 'short-term-bearish', label: 'Short-Term Bearish', filterFn: (item) => item.optionType === 'Put' && item.dte <= 14 && item.delta >= 0.10 && item.delta <= 0.40 },
    { id: 'vol-expansion', label: 'Vol Expansion', filterFn: (item) => item.iv5dPointDiff !== null && item.iv5dPointDiff > 25 },
    { id: 'bullish-reversal', label: 'Bullish Reversal', filterFn: (item) => item.optionType === 'Call' && item.oi5dChangePercent !== null && item.oi5dChangePercent > 100 },
    { id: 'bullish-lotto', label: 'bullish lotto', filterFn: (item) => item.optionType === 'Call' && item.dte <= 3 && item.delta < 0.15 }
  ]

  // Data fetching
  const loadData = useCallback(async (currentTicker: string) => {
    try {
      setIsLoading(true)
      setError(null)
      const flowItems = await getOptionsFlowData(currentTicker)
      setData(flowItems)
    } catch (err) {
      console.error("Failed to load options flow:", err)
      setError("Failed to sync Options Flow data. Please ensure the backend server and database are running.")
      setData([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial fetch and polling
  useEffect(() => {
    loadData(ticker)
  }, [ticker, loadData])

  useEffect(() => {
    if (!isPlaying) return
    
    const interval = setInterval(() => {
      loadData(ticker)
    }, 15000) // Poll every 15s when active

    return () => clearInterval(interval)
  }, [ticker, isPlaying, loadData])

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

  // Generate short 2-char prefix for ticker icons
  const getTickerPrefix = (symbol: string) => {
    return symbol.slice(0, 2).toLowerCase()
  }

  return (
    <div className="flex flex-col h-full bg-[#050608] text-[#D1D4DC] font-sans antialiased border border-[#14161C] rounded-lg overflow-hidden select-none">
      {/* ─── TITLE & CONTROLS HEADER ─── */}
      <div className="flex flex-row items-center justify-between px-5 py-3 border-b border-[#13161C] bg-[#0A0C10] gap-4">
        {/* Preset Name */}
        <h1 className="text-base font-bold font-mono tracking-tight text-white capitalize">
          {presets.find(p => p.id === activePreset)?.label || "Options Flow"}
        </h1>

        {/* Right Controls */}
        <div className="flex items-center gap-2">
          {/* Search Dropdown */}
          <div className="relative">
            <button 
              onClick={() => setTickerSearchOpen(!tickerSearchOpen)}
              className="flex items-center justify-between w-[120px] h-8 px-2.5 bg-[#0D1015] border border-[#20242D] rounded text-xs font-mono hover:border-[#303644] transition-colors text-white"
            >
              <span>{ticker}</span>
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>

            {tickerSearchOpen && (
              <div className="absolute right-0 mt-1 w-[120px] bg-[#0D1015] border border-[#20242D] rounded shadow-2xl z-50 py-1 font-mono text-xs max-h-40 overflow-y-auto">
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

      {/* ─── TABS / PRESETS CONTAINER ─── */}
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

        <button className="flex items-center gap-1 px-3 py-1 rounded text-xs font-mono bg-transparent text-[#00E676] border border-[#00E676]/20 hover:bg-[#00E676]/5 transition-colors">
          <Plus className="w-3 h-3" />
          <span>Add custom</span>
        </button>

        {/* Action Tools */}
        <div className="ml-auto flex items-center gap-1">
          <button 
            onClick={() => loadData(ticker)}
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
                      className="rounded border-[#20242D] bg-black text-[#00E676] focus:ring-0" 
                    />
                    <span>{col}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── DATA GRID TABLE ─── */}
      <div className="flex-1 overflow-auto bg-[#050608]">
        {isLoading && data.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-xs font-mono text-gray-500 gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>SYNCING REAL-TIME SNAPSHOTS...</span>
          </div>
        ) : error && data.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-xs font-mono text-red-400 p-4 text-center">
            <span>{error}</span>
            <button onClick={() => loadData(ticker)} className="mt-3 px-3 py-1 bg-red-500/10 border border-red-500/30 text-red-400 rounded hover:bg-red-500/20">
              RETRY CONNECTION
            </button>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead className="bg-[#0A0C10] sticky top-0 border-b border-[#14161C] text-gray-400 select-none z-10">
              <tr>
                {visibleColumns.time && <th className="px-3 py-2 font-semibold text-gray-400">Time</th>}
                {visibleColumns.ticker && <th className="px-3 py-2 font-semibold text-gray-400">Ticker</th>}
                {visibleColumns.contract && <th className="px-3 py-2 font-semibold text-gray-400">Contract</th>}
                {visibleColumns.stock && <th className="px-3 py-2 font-semibold text-gray-400">Stock</th>}
                {visibleColumns.last && <th className="px-3 py-2 font-semibold text-gray-400">Last</th>}
                
                {visibleColumns.change && (
                  <th 
                    onClick={() => handleSort('changePercent')}
                    className="px-3 py-2 font-semibold text-gray-400 cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>Chg %</span>
                      <ArrowUpDown className="w-3 h-3 text-gray-500" />
                    </div>
                  </th>
                )}

                {visibleColumns.volume && <th className="px-3 py-2 font-semibold text-gray-400">Volume</th>}
                {visibleColumns.oi && <th className="px-3 py-2 font-semibold text-gray-400">OI</th>}

                {visibleColumns.oi5d && (
                  <th 
                    onClick={() => handleSort('oi5dChangePercent')}
                    className="px-3 py-2 font-semibold text-gray-400 cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>5d OI%</span>
                      <ArrowUpDown className="w-3 h-3 text-gray-500" />
                    </div>
                  </th>
                )}

                {visibleColumns.otm && (
                  <th className="px-3 py-2 font-semibold text-gray-400">
                    <span>% OTM</span>
                  </th>
                )}

                {visibleColumns.iv && <th className="px-3 py-2 font-semibold text-gray-400">IV</th>}

                {visibleColumns.iv5d && (
                  <th 
                    onClick={() => handleSort('iv5dPointDiff')}
                    className="px-3 py-2 font-semibold text-gray-400 cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>5d IV%</span>
                      <ArrowUpDown className="w-3 h-3 text-gray-500" />
                    </div>
                  </th>
                )}

                {visibleColumns.delta && <th className="px-3 py-2 font-semibold text-gray-400">Delta</th>}
                {visibleColumns.dte && <th className="px-3 py-2 font-semibold text-gray-400">DTE</th>}
                {visibleColumns.earnings && <th className="px-3 py-2 font-semibold text-gray-400">Earnings</th>}

                <th className="px-3 py-2 w-8 text-center">
                  <button className="text-gray-500 hover:text-white transition-colors">
                    <Plus className="w-3 h-3" />
                  </button>
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#101217] bg-[#050608]">
              {processedData.length === 0 ? (
                <tr>
                  <td colSpan={16} className="text-center py-8 text-gray-500">
                    No contracts matching active preset filters.
                  </td>
                </tr>
              ) : (
                processedData.map((row) => {
                  const isChangePositive = row.changePercent !== null && row.changePercent >= 0
                  
                  return (
                    <tr key={row.id} className="hover:bg-[#0E1117] transition-colors border-b border-[#0F1116] group">
                      {/* Time */}
                      {visibleColumns.time && (
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                          {row.time}
                        </td>
                      )}

                      {/* Ticker badging matching screenshot exactly */}
                      {visibleColumns.ticker && (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded-sm bg-[#0052FF] flex items-center justify-center text-[7px] text-white font-sans font-black select-none uppercase">
                              {getTickerPrefix(row.ticker)}
                            </div>
                            <span className="bg-[#1C202E] text-white text-[9px] px-1 py-0.5 rounded font-bold">
                              {row.ticker}
                            </span>
                          </div>
                        </td>
                      )}

                      {/* Contract Link */}
                      {visibleColumns.contract && (
                        <td className="px-3 py-2 text-[#4A90E2] font-semibold whitespace-nowrap cursor-pointer hover:underline">
                          {row.contractName}
                        </td>
                      )}

                      {/* Stock Spot Price */}
                      {visibleColumns.stock && (
                        <td className="px-3 py-2 text-gray-400">
                          ${row.stockPrice.toFixed(2)}
                        </td>
                      )}

                      {/* Last Price */}
                      {visibleColumns.last && (
                        <td className="px-3 py-2 text-white font-semibold">
                          ${row.lastPrice.toFixed(2)}
                        </td>
                      )}

                      {/* Chg % */}
                      {visibleColumns.change && (
                        <td className={`px-3 py-2 font-semibold ${row.changePercent === null ? 'text-gray-500' : isChangePositive ? 'text-[#00E676]' : 'text-[#FF3860]'}`}>
                          {row.changePercent === null ? '--' : `${isChangePositive ? '+' : ''}${row.changePercent.toFixed(2)}%`}
                        </td>
                      )}

                      {/* Volume */}
                      {visibleColumns.volume && (
                        <td className="px-3 py-2 text-white">
                          {row.volume.toLocaleString()}
                        </td>
                      )}

                      {/* OI */}
                      {visibleColumns.oi && (
                        <td className="px-3 py-2 text-gray-400">
                          {row.openInterest.toLocaleString()}
                        </td>
                      )}

                      {/* 5d OI% */}
                      {visibleColumns.oi5d && (
                        <td className={`px-3 py-2 font-semibold ${row.oi5dChangePercent === null ? 'text-gray-500' : row.oi5dChangePercent >= 0 ? 'text-[#00E676]' : 'text-[#FF3860]'}`}>
                          {row.oi5dChangePercent === null ? '--' : `${row.oi5dChangePercent >= 0 ? '+' : ''}${row.oi5dChangePercent.toFixed(2)}%`}
                        </td>
                      )}

                      {/* % OTM */}
                      {visibleColumns.otm && (
                        <td className="px-3 py-2 text-gray-400">
                          {row.otmPercent.toFixed(2)}%
                        </td>
                      )}

                      {/* IV */}
                      {visibleColumns.iv && (
                        <td className="px-3 py-2 text-gray-300">
                          {row.ivPercent.toFixed(1)}%
                        </td>
                      )}

                      {/* 5d IV% */}
                      {visibleColumns.iv5d && (
                        <td className={`px-3 py-2 ${row.iv5dPointDiff === null ? 'text-gray-500' : 'text-gray-300'}`}>
                          {row.iv5dPointDiff === null ? '--' : `${row.iv5dPointDiff >= 0 ? '+' : ''}${row.iv5dPointDiff.toFixed(2)}`}
                        </td>
                      )}

                      {/* Delta */}
                      {visibleColumns.delta && (
                        <td className="px-3 py-2 text-gray-300">
                          {row.delta.toFixed(4)}
                        </td>
                      )}

                      {/* DTE */}
                      {visibleColumns.dte && (
                        <td className="px-3 py-2 text-gray-300">
                          {row.dte}
                        </td>
                      )}

                      {/* Earnings */}
                      {visibleColumns.earnings && (
                        <td className="px-3 py-2 text-gray-400">
                          {row.earningsRemainingDays !== null ? `${row.earningsRemainingDays}d` : '--'}
                        </td>
                      )}

                      {/* Spacer */}
                      <td className="px-3 py-2"></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
