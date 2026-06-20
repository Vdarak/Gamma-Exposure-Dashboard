"use client"

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { JournalTrade } from "./types"
import { Heatmap } from "./heatmap"
import { CalendarView } from "./calendar-view"
import { TradeForm } from "./trade-form"
import { TradeDetail } from "./trade-detail"
import { Analytics } from "./analytics"
import {
  getJournalTrades,
  createJournalTrade,
  updateJournalTrade,
  deleteJournalTrade,
  getJournalSetting,
  updateJournalSetting
} from "@/lib/backend-api"
import { Plus, RefreshCw, X, TrendingUp, ArrowDownRight, Percent, Zap, Calendar as CalendarIcon, Terminal } from "lucide-react"
import { AIAnalystPanel } from "../AIAnalystPanel"

function normalizeOption(opt: any) {
  if (!opt) return { strike: 0, type: null, expirationStr: null, price: 0 }

  let strike = 0
  if (typeof opt.strike === 'number') {
    strike = opt.strike
  } else if (opt.strike) {
    strike = parseFloat(opt.strike)
  }

  let type: "C" | "P" | null = null
  const rawType = (opt.type || opt.option_type || '').toString().toUpperCase()
  if (rawType === 'C' || rawType === 'CALL') {
    type = 'C'
  } else if (rawType === 'P' || rawType === 'PUT') {
    type = 'P'
  }

  let expirationStr: string | null = null
  const rawExp = opt.expiration || opt.expiration_date
  if (rawExp) {
    if (typeof rawExp === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawExp)) {
      expirationStr = rawExp.substring(0, 10)
    } else {
      try {
        const d = new Date(rawExp)
        if (!isNaN(d.getTime())) {
          expirationStr = d.toISOString().split('T')[0]
        }
      } catch (e) {
        // ignore
      }
    }
  }

  // Parse from symbol if fields are missing (e.g. OSI symbol format: [Ticker][YYMMDD][C/P][Strike (8 digits)])
  const symbol = opt.option || ''
  const match = symbol.match(/^([A-Z_]+)(\d{6})([CP])(\d{8})$/)
  if (match) {
    const [, , yyymmdd, cp, strikeCode] = match
    
    if (strike === 0) {
      strike = parseInt(strikeCode, 10) / 1000
    }
    
    if (!type) {
      type = cp === 'C' ? 'C' : 'P'
    }
    
    if (!expirationStr) {
      const yy = yyymmdd.substring(0, 2)
      const mm = yyymmdd.substring(2, 4)
      const dd = yyymmdd.substring(4, 6)
      expirationStr = `20${yy}-${mm}-${dd}`
    }
  }

  const bid = parseFloat(opt.bid || '0')
  const ask = parseFloat(opt.ask || '0')
  const last = parseFloat(opt.last || opt.lastPrice || opt.last_price || opt.last_trade_price || '0')

  let price = 0
  if (!isNaN(ask) && ask > 0) {
    price = ask
  } else if (!isNaN(last) && last > 0) {
    price = last
  }

  return { strike, type, expirationStr, price }
}

export function TradingJournal() {
  const [trades, setTrades] = useState<JournalTrade[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Starting balance input
  const [startBalance, setStartBalance] = useState(2566.19)
  const [currentJournalTab, setCurrentJournalTab] = useState<'journal' | 'comparison' | 'analysis'>('journal')

  // Modals & Panels State
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTrade, setEditingTrade] = useState<JournalTrade | null>(null)
  
  const [selectedTrade, setSelectedTrade] = useState<JournalTrade | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false)

  // Inspect trades on a single day
  const [inspectedDate, setInspectedDate] = useState<string | null>(null)

  // For live price auto-refresh
  const [refreshingPrices, setRefreshingPrices] = useState(false)
  const hasAutoRefreshedRef = useRef(false)
  const tradesRef = useRef<JournalTrade[]>([])

  // Keep tradesRef updated
  useEffect(() => {
    tradesRef.current = trades
  }, [trades])

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

  // Fetch starting balance setting
  const loadSettings = useCallback(async () => {
    try {
      const balStr = await getJournalSetting("start_balance")
      if (balStr !== null) {
        setStartBalance(parseFloat(balStr))
      }
    } catch (err) {
      console.error("Failed to load starting balance setting:", err)
    }
  }, [])

  // Function to fetch current prices and update open positions
  const refreshOpenPositionPrices = useCallback(async () => {
    const activeOpen = tradesRef.current.filter((t) => t.status === "Open")
    if (activeOpen.length === 0) return
    
    setRefreshingPrices(true)
    let updatedCount = 0
    let failedCount = 0

    try {
      // Group open positions by ticker to minimize API requests
      const tickers = Array.from(new Set(activeOpen.map(p => p.ticker.toUpperCase())))
      
      // Fetch options/spot data for all tickers in parallel
      const tickerDataMap: Record<string, any> = {}
      await Promise.all(
        tickers.map(async (ticker) => {
          try {
            const market = ['NIFTY', 'BANKNIFTY', 'RELIANCE'].includes(ticker) ? 'INDIA' : 'USA'
            const apiRoute = market === 'INDIA' ? `/api/options/india/${ticker}` : `/api/options/${ticker}`
            const response = await fetch(apiRoute)
            if (response.ok) {
              const data = await response.json()
              tickerDataMap[ticker] = data
            }
          } catch (err) {
            console.error(`Failed to fetch price data for ticker ${ticker}:`, err)
          }
        })
      )

      // Update each open position
      for (const trade of activeOpen) {
        const tickerData = tickerDataMap[trade.ticker.toUpperCase()]
        if (!tickerData) {
          failedCount++
          continue
        }

        let newPrice = 0
        if (trade.tradeType === "Equity") {
          newPrice = tickerData.current_price || tickerData.price || 0
        } else if (trade.tradeType === "Option") {
          // Find option contract matching strike, optionType, expiration
          const options = tickerData.options || []
          const targetStrike = trade.strike
          const targetExp = trade.expiration // format: YYYY-MM-DD
          
          const matchedOpt = options.find((opt: any) => {
            const normalizedOpt = normalizeOption(opt)
            return (
              normalizedOpt.strike === targetStrike &&
              normalizedOpt.type === trade.optionType &&
              normalizedOpt.expirationStr === targetExp
            )
          })

          if (matchedOpt) {
            const normalizedOpt = normalizeOption(matchedOpt)
            if (normalizedOpt.price > 0) {
              newPrice = normalizedOpt.price
            } else {
              failedCount++
              continue
            }
          } else {
            failedCount++
            continue
          }
        }

        if (newPrice > 0) {
          // Calculate new P&L and return percentage
          const qtyVal = trade.quantity
          const entryVal = trade.entryPrice
          const feesVal = trade.fees || 0
          
          let calcPnl = 0
          if (trade.direction === "Buy") {
            calcPnl = (newPrice - entryVal) * qtyVal - feesVal
          } else {
            calcPnl = (entryVal - newPrice) * qtyVal - feesVal
          }
          const calcPnlPct = (calcPnl / (entryVal * qtyVal)) * 100

          const updatedTrade: JournalTrade = {
            ...trade,
            exitPrice: newPrice, // open trades store currentPrice in exitPrice
            pnl: parseFloat(calcPnl.toFixed(2)),
            pnlPercent: parseFloat(calcPnlPct.toFixed(2))
          }

          // Call API to update the database
          await updateJournalTrade(trade.id, updatedTrade)
          updatedCount++
        } else {
          failedCount++
        }
      }

      if (updatedCount > 0) {
        // Reload all trades to refresh the UI
        const data = await getJournalTrades()
        setTrades(data || [])
      }
    } catch (err) {
      console.error("Error refreshing open position prices:", err)
    } finally {
      setRefreshingPrices(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadTrades()
    loadSettings()
  }, [loadTrades, loadSettings])

  // Trigger auto-refresh of open position prices once initial trades load
  useEffect(() => {
    if (trades.length > 0 && !hasAutoRefreshedRef.current) {
      hasAutoRefreshedRef.current = true
      refreshOpenPositionPrices()
    }
  }, [trades, refreshOpenPositionPrices])

  // Save starting balance setting to backend
  const handleSaveBalance = async (value: number) => {
    try {
      await updateJournalSetting("start_balance", value.toString())
    } catch (err) {
      console.error("Failed to save starting balance to backend:", err)
    }
  }

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
        maxLossStreak: 0,
        longPnl: 0,
        shortPnl: 0,
        avgWin: 0,
        avgLoss: 0,
        wins: 0,
        losses: 0
      }
    }

    const netPnl = trades.reduce((sum, t) => sum + t.pnl, 0)
    const winsList = trades.filter((t) => t.pnl > 0)
    const lossesList = trades.filter((t) => t.pnl < 0)
    const wins = winsList.length
    const losses = lossesList.length
    const winRate = (wins / totalTrades) * 100

    const grossWins = winsList.reduce((sum, t) => sum + t.pnl, 0)
    const grossLosses = Math.abs(lossesList.reduce((sum, t) => sum + t.pnl, 0))
    const avgWin = wins > 0 ? grossWins / wins : 0
    const avgLoss = lossesList.length > 0 ? grossLosses / lossesList.length : 0

    const longTrades = trades.filter(t => t.direction === "Buy")
    const shortTrades = trades.filter(t => t.direction === "Sell")
    const longPnl = longTrades.reduce((sum, t) => sum + t.pnl, 0)
    const shortPnl = shortTrades.reduce((sum, t) => sum + t.pnl, 0)

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
      maxLossStreak,
      longPnl,
      shortPnl,
      avgWin,
      avgLoss,
      wins,
      losses
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

  const avgWin = metrics.avgWin
  const avgLoss = metrics.avgLoss
  const wins = metrics.wins
  const losses = metrics.losses
  const longPnl = metrics.longPnl
  const shortPnl = metrics.shortPnl

  // Trader's Edge Score Card calculations
  const scoreWin = metrics.winRate
  const scoreRR = Math.min(100, (avgWin / (avgLoss || 1)) * 33)
  const scorePF = Math.min(100, (wins > 0 && losses > 0 ? (avgWin * wins) / (avgLoss * losses) : 1) * 33)
  const compositeScore = Math.round((scoreWin + scoreRR + scorePF) / 3)

  const sparklineWidth = 180
  const sparklineHeight = 45
  
  const sparklinePoints = useMemo(() => {
    if (equityPoints.length <= 1) return ""
    const balances = equityPoints.map(p => p.balance)
    const maxB = Math.max(...balances)
    const minB = Math.min(...balances)
    const range = maxB - minB || 100
    return equityPoints.map((p, idx) => {
      const x = (idx / (equityPoints.length - 1)) * sparklineWidth
      const y = sparklineHeight - 2 - ((p.balance - minB) / range) * (sparklineHeight - 6)
      return `${x},${y}`
    }).join(" ")
  }, [equityPoints])

  const drawdownPoints = useMemo(() => {
    let balance = startBalance
    let maxB = startBalance
    const points: number[] = [0]
    sortedTrades.forEach((trade) => {
      balance += trade.pnl
      if (balance > maxB) {
        maxB = balance
      }
      const ddPct = ((maxB - balance) / maxB) * 100
      points.push(ddPct)
    })
    
    const maxDD = Math.max(...points) || 1
    return points.map((dd, idx) => {
      const x = (idx / (points.length - 1)) * sparklineWidth
      const y = sparklineHeight - 2 - (dd / maxDD) * (sparklineHeight - 6)
      return `${x},${y}`
    }).join(" ")
  }, [sortedTrades, startBalance])

  return (
    <div className="flex-grow flex flex-row min-h-0 bg-black relative w-full h-full">
      <div className="flex-1 flex flex-col pt-2 md:pt-3 pb-24 px-4 md:px-6 bg-black text-[#E5E5E5] font-mono min-h-0 overflow-y-auto gap-6">
      
      {/* 1. Header (TradeSync style) */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-[#15151C] pb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-white uppercase">
            Trading Journal
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
                onBlur={(e) => handleSaveBalance(startBalance)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveBalance(startBalance)
                    e.currentTarget.blur()
                  }
                }}
                className="bg-black border border-[#1A1A1E] text-white pl-4 pr-1.5 py-0.5 rounded text-[11px] font-mono w-24 outline-none focus:border-[#00C805]"
              />
            </div>
          </div>
          
          <button
            onClick={() => setIsAIPanelOpen(!isAIPanelOpen)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded text-[10px] font-bold uppercase border transition-all ${
              isAIPanelOpen
                ? 'bg-[#00E676]/15 text-[#00E676] border-[#00E676]/45 shadow-[0_0_8px_rgba(0,230,118,0.15)] font-bold'
                : 'bg-[#0A0A0C] border-[#1A1A1E] text-gray-300 hover:text-white hover:bg-[#1C202E]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-[#00E676]" /> AI ANALYST
          </button>
          
          <button
            onClick={() => {
              setEditingTrade(null)
              setIsFormOpen(true)
            }}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#00C805] text-black border border-[#00C805] hover:bg-[#00C805]/95 rounded text-[10px] font-bold uppercase transition-all"
          >
            <Plus className="w-3 h-3 stroke-[3]" /> NEW TRADE
          </button>
        </div>
      </header>

      {/* 1.2 Inner Tab Bar */}
      <div className="flex items-center border-b border-[#15151C] pb-2 flex-shrink-0 gap-1.5">
        <button
          onClick={() => setCurrentJournalTab('journal')}
          className={`px-3 py-1.5 text-xs font-mono font-bold rounded transition-all border ${
            currentJournalTab === 'journal'
              ? 'bg-[#121215] text-[#00C805] border-[#25252E] shadow-sm'
              : 'bg-transparent text-[#949494] border-transparent hover:text-white'
          }`}
        >
          Journal
        </button>
        <button 
          onClick={() => alert("Comparison analytics pending data collection service integration.")}
          className="px-3 py-1.5 text-xs font-mono font-bold rounded bg-transparent text-[#949494] border border-transparent hover:text-white"
        >
          Comparison
        </button>
        <button 
          onClick={() => setCurrentJournalTab('analysis')}
          className={`px-3 py-1.5 text-xs font-mono font-bold rounded transition-all border ${
            currentJournalTab === 'analysis'
              ? 'bg-[#121215] text-[#00C805] border-[#25252E] shadow-sm'
              : 'bg-transparent text-[#949494] border-transparent hover:text-white'
          }`}
        >
          Analysis
        </button>
      </div>

      {currentJournalTab === 'journal' ? (
        <>
          {/* 2. Portfolio Balance & Change Indicator */}
          <div className="flex flex-col gap-1 flex-shrink-0">
        <div className="text-5xl font-bold font-data text-white leading-none tracking-tight">
          ${portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className={`text-[10px] font-bold mt-2 flex items-center gap-1.5 ${isPnlPositive ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
          <span>{isPnlPositive ? "▲" : "▼"}</span>
          <span>
            ${Math.abs(metrics.netPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
            ({isPnlPositive ? "+" : "-"}{Math.abs(startBalance > 0 ? (metrics.netPnl / startBalance * 100) : 0).toFixed(2)}%)
          </span>
          <span className="text-[#A3A3A3] uppercase font-bold tracking-tight text-[9px] ml-1">ALL TIME</span>
        </div>
      </div>

      {/* 3. Five key metrics cards row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 flex-shrink-0 text-xs font-mono">
        {/* Win Rate */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2 pb-3 px-4 flex flex-col justify-between h-[94px] hover:border-[#25252E] transition-all">
          <span className="text-[#949494] uppercase font-bold text-[9px] tracking-wider">Win Rate</span>
          <div className="text-2xl font-bold text-white font-data leading-none mt-1">
            {metrics.winRate.toFixed(1)}%
          </div>
          <div className="flex flex-col gap-1 w-full mt-1">
            <div className="flex justify-between text-[8px] text-[#A3A3A3] font-bold">
              <span>{wins} WINS</span>
              <span>{losses} LOSSES</span>
            </div>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden flex">
              <div style={{ width: `${metrics.winRate}%` }} className="bg-[#00C805] h-full" />
              <div style={{ width: `${100 - metrics.winRate}%` }} className="bg-[#FF3B60] h-full" />
            </div>
          </div>
        </div>

        {/* Avg Win/Loss */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2 pb-3 px-4 flex flex-col justify-between h-[94px] hover:border-[#25252E] transition-all">
          <span className="text-[#949494] uppercase font-bold text-[9px] tracking-wider">Avg Win/Loss</span>
          <div className="text-2xl font-bold text-white font-data leading-none mt-1">
            ${(metrics.netPnl / (trades.length || 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="flex flex-col gap-1 w-full mt-1">
            <div className="flex justify-between text-[8px] text-[#A3A3A3] font-bold">
              <span className="text-[#00C805]">+${Math.round(avgWin)}</span>
              <span className="text-[#FF3B60]">-${Math.round(avgLoss)}</span>
            </div>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden flex">
              <div style={{ width: `${avgWin / (avgWin + avgLoss || 1) * 100}%` }} className="bg-[#00C805] h-full" />
              <div style={{ width: `${avgLoss / (avgWin + avgLoss || 1) * 100}%` }} className="bg-[#FF3B60] h-full" />
            </div>
          </div>
        </div>

        {/* Sharpe Ratio */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2 pb-3 px-4 flex flex-col justify-between h-[94px] hover:border-[#25252E] transition-all">
          <span className="text-[#949494] uppercase font-bold text-[9px] tracking-wider">Sharpe Ratio</span>
          <div className="text-2xl font-bold text-white font-data leading-none mt-1">
            {metrics.sharpeRatio.toFixed(2)}
          </div>
          <div className="flex flex-col gap-1 w-full mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase">
              {metrics.sharpeRatio > 2 ? "Excellent" : metrics.sharpeRatio > 1 ? "Good" : "Suboptimal"} Edge
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: `${Math.min(100, Math.max(0, (metrics.sharpeRatio / 3) * 100))}%` }} className="bg-[#00D4FF] h-full" />
            </div>
          </div>
        </div>

        {/* Kelly Sizing / Long vs Short */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2 pb-3 px-4 flex flex-col justify-between h-[94px] hover:border-[#25252E] transition-all">
          <span className="text-[#949494] uppercase font-bold text-[9px] tracking-wider">Kelly Sizing</span>
          <div className={`text-2xl font-bold font-data leading-none mt-1 ${metrics.kellyPercent > 0 ? "text-[#00D4FF]" : "text-[#FF3B60]"}`}>
            {metrics.kellyPercent.toFixed(1)}%
          </div>
          <div className="flex flex-col gap-1 w-full mt-1">
            <div className="flex justify-between text-[8px] text-[#A3A3A3] font-bold">
              <span className="text-[#00C805]">L: +${Math.round(longPnl)}</span>
              <span className="text-[#FF3B60]">S: {shortPnl >= 0 ? "+" : ""}${Math.round(shortPnl)}</span>
            </div>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden flex">
              <div style={{ width: `${Math.max(10, Math.min(90, (Math.abs(longPnl) / (Math.abs(longPnl) + Math.abs(shortPnl) || 1)) * 100))}%` }} className="bg-[#00C805] h-full" />
              <div style={{ width: `${Math.max(10, Math.min(90, (Math.abs(shortPnl) / (Math.abs(longPnl) + Math.abs(shortPnl) || 1)) * 100))}%` }} className="bg-[#FF3B60] h-full" />
            </div>
          </div>
        </div>

        {/* Active Streak */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2 pb-3 px-4 flex flex-col justify-between h-[94px] hover:border-[#25252E] transition-all">
          <span className="text-[#949494] uppercase font-bold text-[9px] tracking-wider">Active Streak</span>
          <div className={`text-2xl font-bold font-data leading-none mt-1 ${isWinStreak ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
            {metrics.currentStreak.count} {isWinStreak ? "W" : "L"}
          </div>
          <div className="flex flex-col gap-1 w-full mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase">
              Max: {metrics.maxWinStreak}W / {metrics.maxLossStreak}L
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: `${isWinStreak ? (metrics.currentStreak.count / (metrics.maxWinStreak || 1)) * 100 : (metrics.currentStreak.count / (metrics.maxLossStreak || 1)) * 100}%` }} className={`h-full ${isWinStreak ? "bg-[#00C805]" : "bg-[#FF3B60]"}`} />
            </div>
          </div>
        </div>
      </div>

      {/* 4. Mini Charts & Score Row (4 Columns Grid) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-shrink-0">
        {/* Card 1: Trader's Edge (Radar) */}
        <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-3 flex flex-col justify-between h-[180px]">
          <div className="flex justify-between items-center border-b border-[#1A1A1E] pb-1">
            <span className="text-[#949494] uppercase font-bold text-[9px] tracking-wider">Trader's Edge</span>
            <span className="text-[10px] text-[#00C805] font-bold font-data">{compositeScore}/100</span>
          </div>
          
          <div className="flex items-center justify-between gap-3 mt-2 mb-1 flex-1">
            {/* Left: Radar SVG (Enlarged to 125x125) */}
            <div className="flex-shrink-0 flex items-center justify-center">
              <svg className="w-[125px] h-[125px] overflow-visible" viewBox="0 0 100 100">
                {/* Background outer circle/rings */}
                <circle cx="50" cy="50" r="35" fill="none" stroke="#25252E" strokeWidth="1" />
                <circle cx="50" cy="50" r="22" fill="none" stroke="#25252E" strokeWidth="1" strokeDasharray="2,2" />
                <circle cx="50" cy="50" r="10" fill="none" stroke="#25252E" strokeWidth="1" strokeDasharray="2,2" />
                
                {/* Three Axes */}
                <line x1="50" y1="50" x2="50" y2="15" stroke="#25252E" strokeWidth="1" />
                <line x1="50" y1="50" x2="80.3" y2="67.5" stroke="#25252E" strokeWidth="1" />
                <line x1="50" y1="50" x2="19.7" y2="67.5" stroke="#25252E" strokeWidth="1" />
                
                {/* Skill Labels on Corners */}
                <text x="50" y="8" textAnchor="middle" fill="#949494" fontSize="8" fontWeight="bold">WIN%</text>
                <text x="83" y="71" textAnchor="start" fill="#949494" fontSize="8" fontWeight="bold">R:R</text>
                <text x="17" y="71" textAnchor="end" fill="#949494" fontSize="8" fontWeight="bold">P.F.</text>
                
                {/* Polygon filled area */}
                <polygon
                  points={`${50},${50 - 35 * (scoreWin / 100)} ${50 + 30.3 * (scoreRR / 100)},${50 + 17.5 * (scoreRR / 100)} ${50 - 30.3 * (scorePF / 100)},${50 + 17.5 * (scorePF / 100)}`}
                  fill="rgba(0, 200, 5, 0.2)"
                  stroke="#00C805"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
            {/* Right: Metrics Stack (Tightly Grouped, Vertically Aligned Labels and Numerics, Equally Spaced) */}
            <div className="flex flex-col justify-between h-[90px] pr-1 min-w-[95px] font-bold py-1">
              <div className="flex justify-between items-center w-full">
                <span className="text-[#949494] text-[8px] uppercase tracking-wider">WIN%</span>
                <span className="text-white font-data text-xs leading-none">{metrics.winRate.toFixed(0)}%</span>
              </div>
              <div className="flex justify-between items-center w-full">
                <span className="text-[#949494] text-[8px] uppercase tracking-wider">R:R</span>
                <span className="text-white font-data text-xs leading-none">1:{(avgWin / (avgLoss || 1)).toFixed(1)}</span>
              </div>
              <div className="flex justify-between items-center w-full">
                <span className="text-[#949494] text-[8px] uppercase tracking-wider">P.F.</span>
                <span className="text-white font-data text-xs leading-none">{(wins > 0 && losses > 0 ? (avgWin * wins) / (avgLoss * losses) : 1).toFixed(1)}x</span>
              </div>
            </div>
          </div>
          {/* Bottom filled bar */}
          <div className="w-full">
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: `${compositeScore}%` }} className="bg-[#00C805] h-full" />
            </div>
          </div>
        </div>

        {/* Card 2: Daily Cumulative P&L */}
        <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-3 flex flex-col justify-between h-[180px]">
          <span className="text-[#949494] uppercase font-bold text-[9px] tracking-wider">Cumulative P&L</span>
          <div className="text-2xl font-bold font-data text-white leading-none mt-2 mb-1">
            {metrics.netPnl >= 0 ? "+" : ""}${metrics.netPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="flex-1 my-1.5 flex items-center justify-center overflow-hidden w-full h-[80px]">
            {equityPoints.length > 1 ? (
              <svg width="100%" height="80" viewBox={`0 0 ${sparklineWidth} ${sparklineHeight}`} preserveAspectRatio="none" className="overflow-visible">
                <polyline
                  fill="none"
                  stroke={isPnlPositive ? "#00C805" : "#FF3B60"}
                  strokeWidth="2"
                  points={sparklinePoints}
                />
              </svg>
            ) : (
              <span className="text-[8px] text-[#666]">INS. POINTS</span>
            )}
          </div>
        </div>

        {/* Card 3: Drawdown sparkline */}
        <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-3 flex flex-col justify-between h-[180px]">
          <span className="text-[#949494] uppercase font-bold text-[9px] tracking-wider">Max Drawdown</span>
          <div className="text-2xl font-bold font-data text-[#FF3B60] leading-none mt-2 mb-1">
            -{metrics.maxDrawdownPercent.toFixed(2)}%
          </div>
          <div className="flex-1 my-1.5 flex items-center justify-center overflow-hidden w-full h-[80px]">
            {sortedTrades.length > 0 ? (
              <svg width="100%" height="80" viewBox={`0 0 ${sparklineWidth} ${sparklineHeight}`} preserveAspectRatio="none" className="overflow-visible">
                <polyline
                  fill="none"
                  stroke="#FF3B60"
                  strokeWidth="2"
                  points={drawdownPoints}
                />
              </svg>
            ) : (
              <span className="text-[8px] text-[#666]">INS. POINTS</span>
            )}
          </div>
        </div>

        {/* Card 4: Active Open Positions */}
        <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-3 flex flex-col justify-between h-[180px] overflow-hidden">
          <div className="flex justify-between items-center border-b border-[#1A1A1E] pb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[#949494] uppercase font-bold text-[9px] tracking-wider">Open Positions</span>
              <button 
                onClick={refreshOpenPositionPrices} 
                disabled={refreshingPrices}
                className="text-[#888] hover:text-white transition-colors p-0.5 rounded"
                title="Refresh Prices"
              >
                <RefreshCw className={`w-2.5 h-2.5 ${refreshingPrices ? 'animate-spin text-[#00C805]' : ''}`} />
              </button>
            </div>
            <span className="text-[8px] bg-black text-[#00D4FF] px-1.5 py-0.5 rounded font-bold">{openPositions.length} active</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 mt-2.5 scrollbar-thin scrollbar-thumb-gray-800 text-[9px]">
            {openPositions.length === 0 ? (
              <div className="text-center py-4 text-[#666] text-[8px] uppercase font-bold">No active positions</div>
            ) : (
              <>
                {openPositions.filter(p => p.tradeType === "Option").length > 0 && (
                  <div className="space-y-1">
                    {openPositions.filter(p => p.tradeType === "Equity").length > 0 && (
                      <div className="text-[8px] text-[#888] font-bold uppercase tracking-wider mb-1">Options</div>
                    )}
                    {openPositions.filter(p => p.tradeType === "Option").map((t) => {
                      const strikeText = t.strike ? ` $${t.strike}${t.optionType}` : ""
                      return (
                        <div
                          key={t.id}
                          onClick={() => {
                            setSelectedTrade(t)
                            setIsDetailOpen(true)
                          }}
                          className="flex justify-between items-center bg-black/60 p-1.5 border border-[#15151C] hover:border-[#333] rounded cursor-pointer transition-all"
                        >
                          <span className="font-bold text-white truncate max-w-[55%]">{t.ticker}{strikeText}</span>
                          <span className={`font-data font-bold ${t.pnl >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
                            {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} ({t.pnlPercent >= 0 ? "+" : ""}{t.pnlPercent.toFixed(1)}%)
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
                
                {openPositions.filter(p => p.tradeType === "Equity").length > 0 && (
                  <div className="space-y-1 mt-2">
                    {openPositions.filter(p => p.tradeType === "Option").length > 0 && (
                      <div className="text-[8px] text-[#888] font-bold uppercase tracking-wider mb-1">Equities</div>
                    )}
                    {openPositions.filter(p => p.tradeType === "Equity").map((t) => (
                      <div
                        key={t.id}
                        onClick={() => {
                          setSelectedTrade(t)
                          setIsDetailOpen(true)
                        }}
                        className="flex justify-between items-center bg-black/60 p-1.5 border border-[#15151C] hover:border-[#333] rounded cursor-pointer transition-all"
                      >
                        <span className="font-bold text-white truncate max-w-[55%]">{t.ticker}</span>
                        <span className={`font-data font-bold ${t.pnl >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
                          {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} ({t.pnlPercent >= 0 ? "+" : ""}{t.pnlPercent.toFixed(1)}%)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <hr className="border-[#1A1A1E] my-1 flex-shrink-0" />

      {/* 5. Bottom Section: Heatmap and Calendar View (Full Width) */}
      <div className="flex-shrink-0 flex flex-col gap-4 bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg pt-2 pb-4 px-4 md:pb-5 md:px-5">
        <div className="flex-shrink-0">
          <Heatmap
            trades={trades}
            onSelectDate={(date) => setInspectedDate(date)}
          />
        </div>
        <div className="flex-shrink-0">
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
        </>
      ) : currentJournalTab === 'analysis' ? (
        <Analytics trades={trades} />
      ) : null}

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

      <AIAnalystPanel
        isOpen={isAIPanelOpen}
        onClose={() => setIsAIPanelOpen(false)}
        onTradeLogged={loadTrades}
        showBriefingTab={false}
        title="JOURNAL AGENT"
        inputPlaceholder="Log a trade or ask about your performance..."
      />
    </div>
  )
}
