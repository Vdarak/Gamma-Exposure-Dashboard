"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import { JournalTrade } from "./types"
import { Heatmap } from "./heatmap"
import { CalendarView } from "./calendar-view"
import { TradeForm } from "./trade-form"
import { TradeDetail } from "./trade-detail"
import {
  getJournalTrades,
  createJournalTrade,
  updateJournalTrade,
  deleteJournalTrade
} from "@/lib/backend-api"
import { Plus, RefreshCw, X, TrendingUp, ArrowDownRight, Percent, Zap, Calendar as CalendarIcon } from "lucide-react"

export function TradingJournal() {
  const [trades, setTrades] = useState<JournalTrade[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Starting balance input
  const [startBalance, setStartBalance] = useState(100000)

  // Modals & Panels State
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTrade, setEditingTrade] = useState<JournalTrade | null>(null)
  
  const [selectedTrade, setSelectedTrade] = useState<JournalTrade | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  // Inspect trades on a single day
  const [inspectedDate, setInspectedDate] = useState<string | null>(null)

  // Fetch all trades from database
  const loadTrades = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getJournalTrades()
      setTrades(data || [])
    } catch (err) {
      console.error(err)
      setError("Unable to sync trading journal with backend. Check DB connections.")
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadTrades()
  }, [loadTrades])

  // Create/Commit Trade
  const handleCreateTrade = async (newTrade: JournalTrade) => {
    try {
      const saved = await createJournalTrade(newTrade)
      setTrades((prev) => [saved, ...prev])
      loadTrades()
    } catch (err) {
      console.error(err)
      alert("Failed to commit trade to database.")
    }
  }

  // Update Trade
  const handleUpdateTrade = async (updatedTrade: JournalTrade) => {
    try {
      const saved = await updateJournalTrade(updatedTrade.id, updatedTrade)
      setTrades((prev) => prev.map((t) => (t.id === saved.id ? saved : t)))
      if (selectedTrade?.id === saved.id) {
        setSelectedTrade(saved)
      }
      loadTrades()
    } catch (err) {
      console.error(err)
      alert("Failed to update trade.")
    }
  }

  // Delete Trade
  const handleDeleteTrade = async (id: string) => {
    try {
      const success = await deleteJournalTrade(id)
      if (success) {
        setTrades((prev) => prev.filter((t) => t.id !== id))
        if (selectedTrade?.id === id) {
          setSelectedTrade(null)
          setIsDetailOpen(false)
        }
        loadTrades()
      }
    } catch (err) {
      console.error(err)
      alert("Failed to delete trade.")
    }
  }

  // Filter open positions
  const openPositions = useMemo(() => {
    return trades.filter((t) => t.status === "Open")
  }, [trades])

  // Chronological sort of trades for equity calculations
  const sortedTrades = useMemo(() => {
    return [...trades].sort((a, b) => {
      const dateDiff = new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
      if (dateDiff !== 0) return dateDiff
      const timeA = a.timeEntered || "00:00"
      const timeB = b.timeEntered || "00:00"
      return timeA.localeCompare(timeB)
    })
  }, [trades])

  // Performance metrics calculation
  const metrics = useMemo(() => {
    const totalTrades = trades.length
    if (totalTrades === 0) {
      return {
        netPnl: 0,
        winRate: 0,
        count: 0,
        sharpeRatio: 0,
        maxDrawdownPercent: 0,
        kellyPercent: 0,
        currentStreak: { type: "Win" as const, count: 0 },
        maxWinStreak: 0,
        maxLossStreak: 0
      }
    }

    const netPnl = trades.reduce((sum, t) => sum + t.pnl, 0)
    const winsList = trades.filter((t) => t.pnl > 0)
    const lossesList = trades.filter((t) => t.pnl < 0)
    const wins = winsList.length
    const winRate = (wins / totalTrades) * 100

    const grossWins = winsList.reduce((sum, t) => sum + t.pnl, 0)
    const grossLosses = Math.abs(lossesList.reduce((sum, t) => sum + t.pnl, 0))
    const avgWin = wins > 0 ? grossWins / wins : 0
    const avgLoss = lossesList.length > 0 ? grossLosses / lossesList.length : 0

    // Kelly Percentage: W - (1 - W) / R
    let kellyPercent = 0
    if (avgLoss > 0) {
      const wDecimal = wins / totalTrades
      const rRatio = avgWin / avgLoss
      kellyPercent = wDecimal - (1 - wDecimal) / rRatio
    } else if (wins > 0) {
      kellyPercent = wins / totalTrades
    }

    // Streaks
    let currentStreakType: "Win" | "Loss" = "Win"
    let currentStreakCount = 0
    let maxWinStreak = 0
    let maxLossStreak = 0
    let tempWinStreak = 0
    let tempLossStreak = 0

    sortedTrades.forEach((trade, idx) => {
      if (trade.pnl > 0) {
        tempWinStreak++
        maxLossStreak = Math.max(maxLossStreak, tempLossStreak)
        tempLossStreak = 0
      } else if (trade.pnl < 0) {
        tempLossStreak++
        maxWinStreak = Math.max(maxWinStreak, tempWinStreak)
        tempWinStreak = 0
      }

      if (idx === sortedTrades.length - 1) {
        if (trade.pnl > 0) {
          currentStreakType = "Win"
          currentStreakCount = tempWinStreak
        } else if (trade.pnl < 0) {
          currentStreakType = "Loss"
          currentStreakCount = tempLossStreak
        }
      }
    })
    maxWinStreak = Math.max(maxWinStreak, tempWinStreak)
    maxLossStreak = Math.max(maxLossStreak, tempLossStreak)

    // Sharpe Ratio
    const dailyPnLMap: Record<string, number> = {}
    trades.forEach((trade) => {
      const date = trade.tradeDate
      dailyPnLMap[date] = (dailyPnLMap[date] || 0) + trade.pnl
    })
    const dailyReturns = Object.values(dailyPnLMap).map((pnl) => pnl / startBalance)
    let sharpeRatio = 0
    if (dailyReturns.length > 1) {
      const mean = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length
      const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (dailyReturns.length - 1)
      const stdDev = Math.sqrt(variance)
      if (stdDev > 0) {
        sharpeRatio = (mean / stdDev) * Math.sqrt(252)
      }
    }

    // Max Drawdown
    let currentEquity = startBalance
    let maxEquitySeen = startBalance
    let maxDrawdownPercent = 0
    sortedTrades.forEach((trade) => {
      currentEquity += trade.pnl
      if (currentEquity > maxEquitySeen) {
        maxEquitySeen = currentEquity
      }
      const ddPct = ((maxEquitySeen - currentEquity) / maxEquitySeen) * 100
      if (ddPct > maxDrawdownPercent) {
        maxDrawdownPercent = ddPct
      }
    })

    return {
      netPnl,
      winRate,
      count: totalTrades,
      sharpeRatio,
      maxDrawdownPercent,
      kellyPercent: kellyPercent * 100,
      currentStreak: { type: currentStreakType, count: currentStreakCount },
      maxWinStreak,
      maxLossStreak
    }
  }, [trades, sortedTrades, startBalance])

  // Equity Curve points
  const equityPoints = useMemo(() => {
    let balance = startBalance
    const points = [{ date: "Start", balance }]
    sortedTrades.forEach((trade) => {
      balance += trade.pnl
      points.push({
        date: trade.tradeDate.slice(5),
        balance
      })
    })
    return points
  }, [sortedTrades, startBalance])

  // SVG coordinates for full-width line chart
  const svgWidth = 800
  const svgHeight = 160
  const chartPaddingX = 0
  const chartPaddingY = 10

  const { pathD, areaD, lastPointX, lastPointY } = useMemo(() => {
    if (equityPoints.length <= 1) {
      return { pathD: "", areaD: "", lastPointX: 0, lastPointY: 0 }
    }
    
    const balances = equityPoints.map(p => p.balance)
    const maxB = Math.max(...balances)
    const minB = Math.min(...balances)
    const bRange = maxB - minB || 1000

    const scaleX = (idx: number) => {
      return chartPaddingX + (idx / (equityPoints.length - 1)) * (svgWidth - chartPaddingX * 2)
    }
    
    const scaleY = (bal: number) => {
      return svgHeight - chartPaddingY - ((bal - minB) / bRange) * (svgHeight - chartPaddingY * 2)
    }

    const pts = equityPoints.map((p, idx) => `${scaleX(idx)},${scaleY(p.balance)}`)
    const path = `M ${pts.join(" L ")}`
    const area = `${path} L ${scaleX(equityPoints.length - 1)},${svgHeight} L ${scaleX(0)},${svgHeight} Z`

    return {
      pathD: path,
      areaD: area,
      lastPointX: scaleX(equityPoints.length - 1),
      lastPointY: scaleY(equityPoints[equityPoints.length - 1].balance)
    }
  }, [equityPoints])

  // Helpers
  const handleAddTradeForDate = (dateStr: string) => {
    setEditingTrade(null)
    setIsFormOpen(true)
    setTimeout(() => {
      const inputEl = document.querySelector('input[type="date"]') as HTMLInputElement
      if (inputEl) inputEl.value = dateStr
    }, 50)
  }

  const inspectedTrades = useMemo(() => {
    if (!inspectedDate) return []
    return trades.filter(t => t.tradeDate === inspectedDate)
  }, [trades, inspectedDate])

  const portfolioValue = startBalance + metrics.netPnl
  const isPnlPositive = metrics.netPnl >= 0
  const isWinStreak = metrics.currentStreak.type === "Win"

  return (
    <div className="flex-grow flex flex-col pt-2 md:pt-3 pb-20 px-4 md:px-6 bg-black text-[#E5E5E5] font-mono min-h-0 select-none overflow-y-auto gap-6">
      
      {/* 1. Header (Clean, Large, Minimalistic, No Book Icon) */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-[#15151C] pb-4 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white uppercase">
            Journal
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
          {/* Starting Balance Control */}
          <div className="flex items-center gap-2 bg-[#0A0A0C] border border-[#1A1A1E] px-3 py-1.5 rounded-md text-[10px]">
            <span className="text-[#D4D4D4] uppercase font-bold">Cash</span>
            <div className="relative flex items-center">
              <span className="text-[#949494] absolute left-1.5">$</span>
              <input
                type="number"
                value={startBalance}
                onChange={(e) => setStartBalance(Math.max(100, parseFloat(e.target.value) || 0))}
                className="bg-black border border-[#1A1A1E] text-white pl-4 pr-1.5 py-0.5 rounded text-[11px] font-mono w-24 outline-none focus:border-[#00C805]"
              />
            </div>
          </div>

          <button
            onClick={loadTrades}
            disabled={loading}
            className="p-2.5 rounded bg-[#0A0A0C] border border-[#1A1A1E] text-[#A3A3A3] hover:text-white transition-colors"
            title="Refresh database snapshot"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          
          <button
            onClick={() => {
              setEditingTrade(null)
              setIsFormOpen(true)
            }}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#00C805] text-black border border-[#00C805] hover:bg-[#00C805]/95 rounded text-[11px] font-bold uppercase transition-all"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" /> NEW TRADE
          </button>
        </div>
      </header>

      {/* 2. Portfolio Balance & Change Indicator (Robinhood style) */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <div className="text-6xl font-bold font-data text-white leading-none tracking-tight">
          ${portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className={`text-xs font-bold mt-2 flex items-center gap-1.5 ${isPnlPositive ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
          <span>{isPnlPositive ? "▲" : "▼"}</span>
          <span>
            ${Math.abs(metrics.netPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
            ({isPnlPositive ? "+" : "-"}{Math.abs(startBalance > 0 ? (metrics.netPnl / startBalance * 100) : 0).toFixed(2)}%)
          </span>
          <span className="text-[#A3A3A3] uppercase font-bold tracking-tight text-[10px] ml-1">ALL TIME</span>
        </div>
      </div>

      {/* 3. Four key metrics in cards placed ABOVE the equity curve */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 flex-shrink-0">
        {/* Sharpe Ratio */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2 pb-3 px-4 flex flex-col justify-between h-20 hover:border-[#25252E] transition-all">
          <span className="text-lg font-bold text-[#F5F5F7] uppercase tracking-wider">
            Sharpe Ratio
          </span>
          <div className="text-3xl font-bold font-data text-white">
            {metrics.sharpeRatio.toFixed(2)}
          </div>
        </div>

        {/* Max Drawdown */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2 pb-3 px-4 flex flex-col justify-between h-20 hover:border-[#25252E] transition-all">
          <span className="text-lg font-bold text-[#F5F5F7] uppercase tracking-wider">
            Max Drawdown
          </span>
          <div className="text-3xl font-bold font-data text-[#FF3B60]">
            -{metrics.maxDrawdownPercent.toFixed(2)}%
          </div>
        </div>

        {/* Kelly Percentage */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2 pb-3 px-4 flex flex-col justify-between h-20 hover:border-[#25252E] transition-all">
          <span className="text-lg font-bold text-[#F5F5F7] uppercase tracking-wider">
            Kelly Sizing
          </span>
          <div className={`text-3xl font-bold font-data ${metrics.kellyPercent > 0 ? "text-[#00D4FF]" : "text-[#FF3B60]"}`}>
            {metrics.kellyPercent.toFixed(1)}%
          </div>
        </div>

        {/* Current & Max Streaks */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2 pb-3 px-4 flex flex-col justify-between h-20 hover:border-[#25252E] transition-all">
          <span className="text-lg font-bold text-[#F5F5F7] uppercase tracking-wider">
            Active Streak
          </span>
          <div className={`text-3xl font-bold font-data ${isWinStreak ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
            {metrics.currentStreak.count} {isWinStreak ? "W" : "L"}
          </div>
        </div>
      </div>

      {/* 4. Full-width Robinhood-style SVG Equity curve */}
      <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2 pb-4 px-4 flex flex-col gap-2 flex-shrink-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#131316] pb-2">
          <span className="text-lg font-bold text-[#F5F5F7] uppercase tracking-wider">Equity Curve</span>
        </div>
        <div className="relative w-full h-[180px]">
          {equityPoints.length > 1 ? (
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={isPnlPositive ? "#00C805" : "#FF3B60"} stopOpacity="0.10" />
                  <stop offset="100%" stopColor={isPnlPositive ? "#00C805" : "#FF3B60"} stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path d={areaD} fill="url(#chartGradient)" />
              <path
                d={pathD}
                fill="none"
                stroke={isPnlPositive ? "#00C805" : "#FF3B60"}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx={lastPointX}
                cy={lastPointY}
                r="4.5"
                fill={isPnlPositive ? "#00C805" : "#FF3B60"}
                className="animate-terminal-pulse"
              />
            </svg>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#949494] text-[10px]">
              INSUFFICIENT HISTORICAL POINTS FOR PLOTTING
            </div>
          )}
        </div>
      </div>

      <hr className="border-[#1A1A1E] my-1 flex-shrink-0" />

      {/* 5. Bottom Section: Split Columns (Desktop: Calendar grid left, Open positions right) */}
      <div className="flex-1 flex flex-col lg:flex-row gap-5 min-h-0">
        
        {/* Left Side: Heatmap and Calendar View */}
        <div className="flex-1 min-h-0 flex flex-col gap-4 bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg pt-2 pb-4 px-4 md:pb-5 md:px-5">
          <div className="flex-shrink-0">
            <Heatmap
              trades={trades}
              onSelectDate={(date) => setInspectedDate(date)}
            />
          </div>
          <div className="flex-1 min-h-0">
            <CalendarView
              trades={trades}
              onSelectTrade={(trade) => {
                setSelectedTrade(trade)
                setIsDetailOpen(true)
              }}
              onAddTradeForDate={handleAddTradeForDate}
              onSelectDate={(date) => setInspectedDate(date)}
            />
          </div>
        </div>

        {/* Right Side: Open Positions panel (Robinhood option listing style) */}
        <aside className="w-full lg:w-[320px] bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg pt-2 pb-4 px-4 flex flex-col gap-3 flex-shrink-0 min-h-[300px] lg:h-auto overflow-hidden">
          <div className="border-b border-[#1A1A1E] pb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-[#00C805]" /> Open Positions
            </span>
            <span className="text-[9px] bg-black border border-[#1A1A1E] text-[#00D4FF] px-1.5 py-0.5 rounded font-bold">
              {openPositions.length} active
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 terminal-scrollbar min-h-0">
            {openPositions.length === 0 ? (
              <div className="text-center py-10 text-[#949494] text-[10px] uppercase font-bold leading-normal">
                No active positions.<br />Log a trade with status "Open" to track here.
              </div>
            ) : (
              openPositions.map((t) => {
                const strikeText = t.tradeType === "Option" && t.strike
                  ? ` $${t.strike} ${t.optionType === "C" ? "Call" : "Put"}`
                  : ""
                const contractsLabel = t.tradeType === "Option"
                  ? `${t.expiration ? t.expiration.slice(5).replace("-", "/") : ""} · ${t.quantity} Buy`
                  : `${t.quantity} Shares`
                
                const isPosProfit = t.pnl >= 0

                return (
                  <div
                    key={t.id}
                    onClick={() => {
                      setSelectedTrade(t)
                      setIsDetailOpen(true)
                    }}
                    className="flex items-center justify-between p-3 rounded bg-black/45 border border-[#15151C] hover:border-[#333] hover:bg-black/80 transition-all cursor-pointer"
                  >
                    <div className="flex flex-col gap-0.5 max-w-[65%]">
                      <span className="text-xs font-bold text-white uppercase truncate">
                        {t.ticker}{strikeText}
                      </span>
                      <span className="text-[9px] text-[#A3A3A3] truncate">
                        {contractsLabel}
                      </span>
                    </div>

                    {/* Right side Robinhood-style border pill (No solid fill, transparent background, colored border & text) */}
                    <div className={`px-2.5 py-1 text-xs font-bold font-data text-right min-w-[75px] rounded border transition-colors ${
                      isPosProfit 
                        ? "border-[#00C805] text-[#00C805] bg-transparent" 
                        : "border-[#FF3B60] text-[#FF3B60] bg-transparent"
                    }`}>
                      ${t.exitPrice.toFixed(2)}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </aside>
      </div>

      {/* Slide-over Form Overlay */}
      <TradeForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false)
          setEditingTrade(null)
        }}
        onSubmit={editingTrade ? handleUpdateTrade : handleCreateTrade}
        initialTrade={editingTrade}
      />

      {/* Trade detail viewer sheet */}
      <TradeDetail
        trade={selectedTrade}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false)
          setSelectedTrade(null)
        }}
        onEdit={(trade) => {
          setIsDetailOpen(false)
          setEditingTrade(trade)
          setIsFormOpen(true)
        }}
        onDelete={handleDeleteTrade}
      />

      {/* Date Inspection Dialog */}
      {inspectedDate && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-40 flex items-center justify-center p-4">
          <div className="bg-[#0A0A0C] border border-[#1A1A1E] text-[#E5E5E5] w-full max-w-lg rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between border-b border-[#1A1A1E] px-4 py-3 bg-[#08080A]">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-[#00D4FF]" />
                <h3 className="font-bold text-xs uppercase tracking-wider text-white">
                  Position logs for {inspectedDate}
                </h3>
              </div>
              <button onClick={() => setInspectedDate(null)} className="text-[#888] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 terminal-scrollbar">
              {inspectedTrades.length === 0 ? (
                <div className="text-center py-8 text-[#949494] text-[10px] uppercase font-bold tracking-wider">
                  No trades committed on this date.
                </div>
              ) : (
                inspectedTrades.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => {
                      setSelectedTrade(t)
                      setInspectedDate(null)
                      setIsDetailOpen(true)
                    }}
                    className="flex items-center justify-between bg-black border border-[#15151C] hover:border-[#333] hover:bg-[#070709] p-3 rounded cursor-pointer transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] px-1 py-0.5 rounded font-bold ${
                        t.direction === "Buy" ? "bg-[#00C805]/15 text-[#00C805]" : "bg-[#FF3B60]/15 text-[#FF3B60]"
                      }`}>
                        {t.direction === "Buy" ? "LONG" : "SHORT"}
                      </span>
                      <div className="flex flex-col">
                        <span className="text-white font-bold text-xs uppercase">{t.ticker}</span>
                        <span className="text-[9px] text-[#A3A3A3] uppercase">{t.tradeType} {t.strategy ? `| ${t.strategy}` : ""}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className={`text-[10px] font-bold ${t.quality === "S" ? "text-terminal-amber" : t.quality === "A" ? "text-[#00C805]" : "text-terminal-purple"}`}>
                        {t.quality}
                      </span>
                      <div className="flex flex-col items-end">
                        <span className={`font-bold font-data text-xs ${t.pnl >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
                          {t.pnl >= 0 ? "+" : ""}${t.pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                        <span className={`text-[9px] font-bold ${t.pnl >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"} opacity-85`}>
                          {t.pnl >= 0 ? "+" : ""}{t.pnlPercent.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="border-t border-[#1A1A1E] px-4 py-3 bg-[#08080A] flex justify-end">
              <button
                onClick={() => {
                  const d = inspectedDate
                  setInspectedDate(null)
                  handleAddTradeForDate(d)
                }}
                className="flex items-center gap-1 text-[10px] bg-[#00D4FF]/10 border border-[#00D4FF]/35 text-[#00D4FF] px-3 py-1.5 rounded font-bold uppercase hover:bg-[#00D4FF] hover:text-black transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> ADD POSITION
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
