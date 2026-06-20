"use client"

import React, { useMemo, useState } from "react"
import { JournalTrade } from "./types"
import { TrendingUp, ArrowDownRight, Award, Zap, Percent, DollarSign, Activity } from "lucide-react"

interface AnalyticsProps {
  trades: JournalTrade[]
}

export function Analytics({ trades }: AnalyticsProps) {
  const [startBalance, setStartBalance] = useState(2566.19) // Default starting balance
  const [activeTab, setActiveTab] = useState<'performance' | 'trades' | 'drawdown'>('performance')

  // 1. Chronological sort of trades
  const sortedTrades = useMemo(() => {
    return [...trades].sort((a, b) => {
      const dateDiff = new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
      if (dateDiff !== 0) return dateDiff
      const timeA = a.timeEntered || "00:00"
      const timeB = b.timeEntered || "00:00"
      return timeA.localeCompare(timeB)
    })
  }, [trades])

  // 2. Metrics & Calculations
  const metrics = useMemo(() => {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        wins: 0,
        losses: 0,
        avgWin: 0,
        avgLoss: 0,
        totalPnl: 0,
        avgPnl: 0,
        avgPnlPercent: 0,
        medianPnl: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        ddStart: "N/A",
        ddEnd: "N/A",
        ddRecovery: "N/A",
        ddDurationBars: 0,
        ddDurationDays: 0,
        returnToDrawdown: 0,
        largestWin: 0,
        largestLoss: 0,
        expectancy: 0,
        kellyPercent: 0,
        currentStreak: { type: "Win", count: 0 },
        maxWinStreak: 0,
        maxLossStreak: 0,
        avgRiskReward: 0,
        period: "N/A"
      }
    }

    const totalTrades = trades.length
    const winsList = trades.filter((t) => t.pnl > 0)
    const lossesList = trades.filter((t) => t.pnl < 0)
    const wins = winsList.length
    const losses = lossesList.length
    const winRate = (wins / totalTrades) * 100

    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0)
    const grossWins = winsList.reduce((sum, t) => sum + t.pnl, 0)
    const grossLosses = Math.abs(lossesList.reduce((sum, t) => sum + t.pnl, 0))

    const avgWin = wins > 0 ? grossWins / wins : 0
    const avgLoss = losses > 0 ? grossLosses / losses : 0
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99.9 : 0
    const avgRiskReward = avgLoss > 0 ? avgWin / avgLoss : 0

    // Period
    const period = sortedTrades.length > 0 ? `${sortedTrades[0].tradeDate} to ${sortedTrades[sortedTrades.length - 1].tradeDate}` : "N/A"

    // Avg P&L
    const avgPnl = totalPnl / totalTrades
    const avgPnlPercent = trades.reduce((sum, t) => sum + t.pnlPercent, 0) / totalTrades

    // Median P&L
    const sortedPnls = trades.map(t => t.pnl).sort((a, b) => a - b)
    const half = Math.floor(sortedPnls.length / 2)
    const medianPnl = sortedPnls.length % 2 !== 0 
      ? sortedPnls[half] 
      : (sortedPnls[half - 1] + sortedPnls[half]) / 2

    // Largest Win / Loss
    const largestWin = Math.max(...trades.map(t => t.pnl), 0)
    const largestLoss = Math.min(...trades.map(t => t.pnl), 0)

    // Expectancy
    const expectancy = (wins / totalTrades) * avgWin - (losses / totalTrades) * avgLoss

    // Kelly Percentage: W - (1 - W) / R
    let kellyPercent = 0
    if (totalTrades > 0) {
      const wDecimal = wins / totalTrades
      if (avgLoss > 0) {
        const rRatio = avgWin / avgLoss
        kellyPercent = wDecimal - (1 - wDecimal) / rRatio
      } else if (wins > 0) {
        kellyPercent = wDecimal
      }
    }

    // Current Streak & Max Streaks
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

    // Annualized Sharpe Ratio
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

    // Build equity curve for drawdown dates
    let bal = startBalance
    const tempEquityCurve = [{ timestamp: "Start", portfolioValue: startBalance }]
    sortedTrades.forEach((t) => {
      bal += t.pnl
      tempEquityCurve.push({ timestamp: t.tradeDate, portfolioValue: bal })
    })

    // Max Drawdown Peak, Valley, and Recovery dates
    let peakIndex = 0
    let maxDrawdown = 0
    let maxDrawdownPercent = 0
    let maxDrawdownPeakIdx = 0
    let maxDrawdownValleyIdx = 0

    for (let i = 0; i < tempEquityCurve.length; i++) {
      const point = tempEquityCurve[i]
      if (point.portfolioValue > tempEquityCurve[peakIndex].portfolioValue) {
        peakIndex = i
      }
      const peakVal = tempEquityCurve[peakIndex].portfolioValue
      const dd = peakVal - point.portfolioValue
      const ddPct = (dd / peakVal) * 100
      
      if (dd > maxDrawdown) {
        maxDrawdown = dd
      }
      if (ddPct > maxDrawdownPercent) {
        maxDrawdownPercent = ddPct
        maxDrawdownPeakIdx = peakIndex
        maxDrawdownValleyIdx = i
      }
    }

    const ddStart = tempEquityCurve.length > 0 ? tempEquityCurve[maxDrawdownPeakIdx].timestamp : "N/A"
    const ddEnd = tempEquityCurve.length > 0 ? tempEquityCurve[maxDrawdownValleyIdx].timestamp : "N/A"
    
    let ddRecovery = 'Unrecovered'
    let ddRecoveryIdx = -1
    if (tempEquityCurve.length > 0 && maxDrawdownPercent > 0) {
      const peakVal = tempEquityCurve[maxDrawdownPeakIdx].portfolioValue
      for (let i = maxDrawdownValleyIdx + 1; i < tempEquityCurve.length; i++) {
        if (tempEquityCurve[i].portfolioValue >= peakVal) {
          ddRecovery = tempEquityCurve[i].timestamp
          ddRecoveryIdx = i
          break
        }
      }
    }

    const ddDurationBars = ddRecoveryIdx !== -1 
      ? ddRecoveryIdx - maxDrawdownPeakIdx 
      : (tempEquityCurve.length > 0 ? (tempEquityCurve.length - 1) - maxDrawdownPeakIdx : 0)

    let ddDurationDays = 0
    if (tempEquityCurve.length > 0 && maxDrawdownPercent > 0) {
      const startDt = new Date(ddStart === "Start" ? sortedTrades[0].tradeDate : ddStart)
      const recoveryDateVal = ddRecoveryIdx !== -1 
        ? ddRecovery 
        : tempEquityCurve[tempEquityCurve.length - 1].timestamp
      const endDt = new Date(recoveryDateVal === "Start" ? sortedTrades[0].tradeDate : recoveryDateVal)
      ddDurationDays = Math.round(Math.abs(endDt.getTime() - startDt.getTime()) / (1000 * 60 * 60 * 24))
    }

    const returnToDrawdown = maxDrawdownPercent > 0 ? (totalPnl / startBalance * 100) / maxDrawdownPercent : 0

    return {
      totalTrades,
      winRate,
      wins,
      losses,
      avgWin,
      avgLoss,
      totalPnl,
      avgPnl,
      avgPnlPercent,
      medianPnl,
      profitFactor,
      sharpeRatio,
      maxDrawdown,
      maxDrawdownPercent,
      ddStart,
      ddEnd,
      ddRecovery,
      ddDurationBars,
      ddDurationDays,
      returnToDrawdown,
      largestWin,
      largestLoss,
      expectancy,
      kellyPercent: kellyPercent * 100,
      currentStreak: { type: currentStreakType, count: currentStreakCount },
      maxWinStreak,
      maxLossStreak,
      avgRiskReward,
      period
    }
  }, [trades, sortedTrades, startBalance])

  // 3. Equity Curve Points
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

  // Grouped Breakdowns
  const strategyStats = useMemo(() => {
    const stats: Record<string, { trades: number; wins: number; pnl: number }> = {}
    trades.forEach((trade) => {
      const strat = trade.strategy || "Uncategorized"
      if (!stats[strat]) {
        stats[strat] = { trades: 0, wins: 0, pnl: 0 }
      }
      stats[strat].trades++
      if (trade.pnl > 0) stats[strat].wins++
      stats[strat].pnl += trade.pnl
    })
    return Object.entries(stats).map(([name, data]) => ({
      name,
      trades: data.trades,
      winRate: (data.wins / data.trades) * 100,
      pnl: data.pnl
    })).sort((a, b) => b.pnl - a.pnl)
  }, [trades])

  const tickerStats = useMemo(() => {
    const stats: Record<string, { trades: number; wins: number; pnl: number }> = {}
    trades.forEach((trade) => {
      const ticker = trade.ticker
      if (!stats[ticker]) {
        stats[ticker] = { trades: 0, wins: 0, pnl: 0 }
      }
      stats[ticker].trades++
      if (trade.pnl > 0) stats[ticker].wins++
      stats[ticker].pnl += trade.pnl
    })
    return Object.entries(stats).map(([name, data]) => ({
      name,
      trades: data.trades,
      winRate: (data.wins / data.trades) * 100,
      pnl: data.pnl
    })).sort((a, b) => b.pnl - a.pnl)
  }, [trades])

  const qualityStats = useMemo(() => {
    const stats: Record<"S" | "A" | "B", { trades: number; wins: number; pnl: number }> = {
      S: { trades: 0, wins: 0, pnl: 0 },
      A: { trades: 0, wins: 0, pnl: 0 },
      B: { trades: 0, wins: 0, pnl: 0 }
    }
    trades.forEach((trade) => {
      const q = trade.quality
      if (stats[q]) {
        stats[q].trades++
        if (trade.pnl > 0) stats[q].wins++
        stats[q].pnl += trade.pnl
      }
    })
    return Object.entries(stats).map(([name, data]) => ({
      name: name as "S" | "A" | "B",
      trades: data.trades,
      winRate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0,
      pnl: data.pnl
    }))
  }, [trades])

  // Custom SVG Chart dimensions and paths
  const svgWidth = 800
  const svgHeight = 240
  const chartPaddingX = 20
  const chartPaddingY = 30

  const { pathD, areaD, minBalance, maxBalance, lastPointX, lastPointY } = useMemo(() => {
    if (equityPoints.length <= 1) {
      return { pathD: "", areaD: "", minBalance: 0, maxBalance: 0, lastPointX: 0, lastPointY: 0 }
    }
    
    const balances = equityPoints.map(p => p.balance)
    const maxB = Math.max(...balances) * 1.01
    const minB = Math.min(...balances) * 0.99
    const bRange = maxB - minB || 1000

    const scaleX = (idx: number) => {
      return chartPaddingX + (idx / (equityPoints.length - 1)) * (svgWidth - chartPaddingX * 2)
    }
    
    const scaleY = (bal: number) => {
      return svgHeight - chartPaddingY - ((bal - minB) / bRange) * (svgHeight - chartPaddingY * 2)
    }

    // Generate Path Points
    const pts = equityPoints.map((p, idx) => `${scaleX(idx)},${scaleY(p.balance)}`)
    const path = `M ${pts.join(" L ")}`
    
    // Generate closed Area Path
    const area = `${path} L ${scaleX(equityPoints.length - 1)},${svgHeight - chartPaddingY} L ${scaleX(0)},${svgHeight - chartPaddingY} Z`

    const lastX = scaleX(equityPoints.length - 1)
    const lastY = scaleY(equityPoints[equityPoints.length - 1].balance)

    return {
      pathD: path,
      areaD: area,
      minBalance: minB,
      maxBalance: maxB,
      lastPointX: lastX,
      lastPointY: lastY
    }
  }, [equityPoints])

  if (trades.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <Activity className="w-12 h-12 text-[#444] mb-3 animate-terminal-pulse" />
        <h3 className="font-bold text-sm text-white uppercase tracking-wider">Analytics Database Empty</h3>
        <p className="text-[10px] text-[#A3A3A3] mt-1 uppercase max-w-sm leading-relaxed">
          No trading positions recorded. Analytics graphs, Sharpe ratios, and drawdown curves will populate as entries are added.
        </p>
      </div>
    )
  }

  const portfolioValue = startBalance + metrics.totalPnl
  const isPnlPositive = metrics.totalPnl >= 0
  const isWinStreak = metrics.currentStreak.type === "Win"

  const renderPerformanceTab = () => {
    const stats = [
      {
        label: 'Net Profit',
        value: `${isPnlPositive ? '+' : ''}$${metrics.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: `${isPnlPositive ? '+' : ''}${(metrics.totalPnl / startBalance * 100).toFixed(2)}% Return`,
        valueColor: isPnlPositive ? 'text-[#00C805]' : 'text-[#FF3B60]',
      },
      {
        label: 'Win Rate',
        value: `${metrics.winRate.toFixed(1)}%`,
        subText: `${metrics.wins} Wins / ${metrics.losses} Losses`,
        valueColor: 'text-white',
      },
      {
        label: 'Sharpe Ratio',
        value: metrics.sharpeRatio.toFixed(2),
        subText: 'Annualized Risk-Adjusted',
        valueColor: 'text-terminal-cyan',
      },
      {
        label: 'Profit Factor',
        value: `${metrics.profitFactor.toFixed(2)}x`,
        subText: 'Gross Profit / Gross Loss',
        valueColor: 'text-white',
      },
      {
        label: 'Calmar Ratio (Return/DD)',
        value: `${metrics.returnToDrawdown.toFixed(2)}x`,
        subText: 'Ratio of Return to Max DD',
        valueColor: 'text-terminal-amber',
      },
      {
        label: 'Expectancy',
        value: `${metrics.expectancy >= 0 ? '+' : ''}$${metrics.expectancy.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: 'Expected outcome per trade',
        valueColor: metrics.expectancy >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]',
      }
    ]

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5 flex-shrink-0">
        {stats.map((stat, idx) => (
          <div 
            key={idx} 
            className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2.5 pb-3 px-4 flex flex-col justify-between h-20 hover:border-[#25252E] transition-all"
          >
            <span className="text-[9px] font-bold text-[#A3A3A3] uppercase tracking-wider">
              {stat.label}
            </span>
            <div className="flex flex-col">
              <div className={`text-lg font-bold font-data leading-none ${stat.valueColor}`}>
                {stat.value}
              </div>
              <span className="text-[9px] text-[#555] font-mono mt-1">
                {stat.subText}
              </span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  const renderTradesTab = () => {
    const stats = [
      {
        label: 'Total Trades',
        value: metrics.totalTrades.toString(),
        subText: 'Closed positions count',
        valueColor: 'text-white',
      },
      {
        label: 'Avg P&L',
        value: `${metrics.avgPnl >= 0 ? '+' : ''}$${metrics.avgPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: `${metrics.avgPnlPercent >= 0 ? '+' : ''}${metrics.avgPnlPercent.toFixed(2)}% Avg Trade`,
        valueColor: metrics.avgPnl >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]',
      },
      {
        label: 'Median P&L',
        value: `${metrics.medianPnl >= 0 ? '+' : ''}$${metrics.medianPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: 'Middle trade performance',
        valueColor: metrics.medianPnl >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]',
      },
      {
        label: 'Avg Win / Loss',
        value: `+$${metrics.avgWin.toLocaleString(undefined, { maximumFractionDigits: 0 })} / -$${metrics.avgLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        subText: `Wins Avg vs Losses Avg`,
        valueColor: 'text-white',
      },
      {
        label: 'Largest Win',
        value: `+$${metrics.largestWin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: 'Best single trade result',
        valueColor: 'text-[#00C805]',
      },
      {
        label: 'Largest Loss',
        value: `-$${Math.abs(metrics.largestLoss).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: 'Worst single trade result',
        valueColor: 'text-[#FF3B60]',
      }
    ]

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5 flex-shrink-0">
        {stats.map((stat, idx) => (
          <div 
            key={idx} 
            className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2.5 pb-3 px-4 flex flex-col justify-between h-20 hover:border-[#25252E] transition-all"
          >
            <span className="text-[9px] font-bold text-[#A3A3A3] uppercase tracking-wider">
              {stat.label}
            </span>
            <div className="flex flex-col">
              <div className={`text-lg font-bold font-data leading-none ${stat.valueColor}`}>
                {stat.value}
              </div>
              <span className="text-[9px] text-[#555] font-mono mt-1">
                {stat.subText}
              </span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  const renderDrawdownTab = () => {
    const recoveryStr = metrics.ddRecovery === 'Unrecovered' ? 'Active / Unrecovered' : metrics.ddRecovery
    
    const stats = [
      {
        label: 'Max Drawdown',
        value: `-${metrics.maxDrawdownPercent.toFixed(2)}%`,
        subText: `Peak-to-Valley ($${Math.round(metrics.maxDrawdown).toLocaleString()})`,
        valueColor: 'text-[#FF3B60]',
      },
      {
        label: 'Drawdown Start',
        value: metrics.ddStart || 'N/A',
        subText: 'Date of preceding peak',
        valueColor: 'text-white',
      },
      {
        label: 'Drawdown Valley',
        value: metrics.ddEnd || 'N/A',
        subText: 'Date of lowest equity trough',
        valueColor: 'text-white',
      },
      {
        label: 'Drawdown Recovery',
        value: recoveryStr,
        subText: 'Date back to peak level',
        valueColor: metrics.ddRecovery === 'Unrecovered' ? 'text-terminal-amber' : 'text-[#00C805]',
      },
      {
        label: 'Drawdown Duration',
        value: `${metrics.ddDurationDays} Days`,
        subText: `${metrics.ddDurationBars} trades in drawdown`,
        valueColor: 'text-white',
      },
      {
        label: 'Streaks (Win / Loss)',
        value: `${metrics.maxWinStreak} W / ${metrics.maxLossStreak} L`,
        subText: 'Max consecutive trades',
        valueColor: 'text-white',
      }
    ]

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5 flex-shrink-0">
        {stats.map((stat, idx) => (
          <div 
            key={idx} 
            className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2.5 pb-3 px-4 flex flex-col justify-between h-20 hover:border-[#25252E] transition-all"
          >
            <span className="text-[9px] font-bold text-[#A3A3A3] uppercase tracking-wider">
              {stat.label}
            </span>
            <div className="flex flex-col">
              <div className={`text-[10px] font-bold font-mono truncate leading-none ${stat.valueColor}`}>
                {stat.value}
              </div>
              <span className="text-[9px] text-[#555] font-mono mt-1">
                {stat.subText}
              </span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex-grow flex flex-col gap-5 overflow-y-auto pr-0.5 terminal-scrollbar min-h-0 text-[#E5E5E5] pb-6">
      
      {/* 1. Robinhood-style Massive Typography Balance Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#15151C] pb-4 flex-shrink-0">
        <div>
          {/* Portfolio Balance */}
          <div className="text-5xl font-bold font-data text-white leading-none tracking-tight">
            ${portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          {/* Portfolio return indicator */}
          <div className={`text-xs font-bold mt-2.5 flex items-center gap-1.5 ${isPnlPositive ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
            <span>{isPnlPositive ? "▲" : "▼"}</span>
            <span>
              ${Math.abs(metrics.totalPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
              ({isPnlPositive ? "+" : "-"}{Math.abs(metrics.totalPnl / startBalance * 100).toFixed(2)}%)
            </span>
            <span className="text-[#A3A3A3] uppercase font-bold tracking-tight text-[10px] ml-1">ALL TIME</span>
          </div>
        </div>

        {/* Starting Balance Input Control */}
        <div className="flex items-center gap-3 bg-black/40 border border-[#1A1A1E] px-3 py-1.5 rounded-lg">
          <label className="text-[9px] text-[#A3A3A3] uppercase font-bold">Cash</label>
          <div className="relative flex items-center">
            <span className="text-[#949494] absolute left-1.5 text-xs">$</span>
            <input
              type="number"
              value={startBalance}
              onChange={(e) => setStartBalance(Math.max(100, parseFloat(e.target.value) || 0))}
              className="bg-black border border-[#1A1A1E] text-white pl-4 pr-1.5 py-0.5 rounded text-[11px] font-mono w-28 focus:border-terminal-purple/45 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Sub-Tabs Selector */}
      <div className="flex border-b border-[#131316] gap-2 pb-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('performance')}
          className={`px-3 py-1 rounded text-[10px] font-bold font-mono transition-all uppercase ${
            activeTab === 'performance' ? 'bg-[#1A1A1E] text-terminal-green' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Performance Summary
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('trades')}
          className={`px-3 py-1 rounded text-[10px] font-bold font-mono transition-all uppercase ${
            activeTab === 'trades' ? 'bg-[#1A1A1E] text-terminal-green' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Trade Details
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('drawdown')}
          className={`px-3 py-1 rounded text-[10px] font-bold font-mono transition-all uppercase ${
            activeTab === 'drawdown' ? 'bg-[#1A1A1E] text-terminal-green' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Drawdowns & Streaks
        </button>
      </div>

      {/* 2. Sub-Tab Grid Contents */}
      {activeTab === 'performance' && renderPerformanceTab()}
      {activeTab === 'trades' && renderTradesTab()}
      {activeTab === 'drawdown' && renderDrawdownTab()}

      {/* 3. Sleek Full-width Robinhood-style Equity Graph */}
      <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg pt-2 pb-4 px-4 flex flex-col gap-3 flex-shrink-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#131316] pb-2">
          <span className="text-lg font-bold text-[#F5F5F7] uppercase tracking-wider">Equity Curve</span>
        </div>

        <div className="relative w-full h-[250px] bg-black/10">
          {equityPoints.length > 1 ? (
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
              
              {/* Draw Gradient Fill Under Curve */}
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={isPnlPositive ? "#00C805" : "#FF3B60"} stopOpacity="0.10" />
                  <stop offset="100%" stopColor={isPnlPositive ? "#00C805" : "#FF3B60"} stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path d={areaD} fill="url(#chartGradient)" />

              {/* Draw main path line */}
              <path
                d={pathD}
                fill="none"
                stroke={isPnlPositive ? "#00C805" : "#FF3B60"}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* End Point Glow Circle */}
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

      {/* 4. Secondary Statistics List */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-[#15151C] pt-5 flex-shrink-0">
        
        {/* Period & Kelly Stats */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg p-4 flex flex-col justify-between">
          <div className="border-b border-[#131316] pb-2 text-white font-bold uppercase tracking-wider text-[10px]">
            Journal Period & Sizing
          </div>
          <div className="divide-y divide-[#131316] flex-1 flex flex-col justify-around text-[11px] font-mono mt-2">
            <div className="py-2.5 flex justify-between">
              <span className="text-[#A3A3A3] uppercase">Trading Period</span>
              <span className="text-white font-bold text-[9px] truncate max-w-[150px]" title={metrics.period}>{metrics.period}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-[#A3A3A3] uppercase">Starting Balance</span>
              <span className="text-white font-bold font-data">${startBalance.toLocaleString()}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-[#A3A3A3] uppercase">Kelly Criterion Sizing</span>
              <span className={`font-bold font-data ${metrics.kellyPercent > 0 ? "text-terminal-cyan" : "text-[#FF3B60]"}`}>
                {metrics.kellyPercent.toFixed(1)}%
              </span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-[#A3A3A3] uppercase">Realized R:R Ratio</span>
              <span className="text-terminal-cyan font-bold font-data">1:{metrics.avgRiskReward.toFixed(2)}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-[#A3A3A3] uppercase">Streak Type</span>
              <span className={`font-bold uppercase ${metrics.currentStreak.type === "Win" ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
                {metrics.currentStreak.count} {metrics.currentStreak.type}s
              </span>
            </div>
          </div>
        </div>

        {/* Strategy breakdowns */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg overflow-hidden flex flex-col">
          <div className="border-b border-[#1A1A1E] bg-[#0C0C0E] px-4 py-2.5 text-[10px] font-bold text-[#A3A3A3] uppercase tracking-wider">
            Performance By Strategy
          </div>
          <div className="divide-y divide-[#131316] max-h-56 overflow-y-auto px-4 terminal-scrollbar flex-grow">
            {strategyStats.map((strat) => (
              <div key={strat.name} className="py-2.5 flex justify-between items-center text-[11px]">
                <div className="flex flex-col">
                  <span className="text-white font-bold max-w-[130px] truncate">{strat.name}</span>
                  <span className="text-[9px] text-[#B5B5B5] font-semibold">{strat.trades} trades | WR: {strat.winRate.toFixed(0)}%</span>
                </div>
                <span className={`font-bold font-data ${strat.pnl >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
                  {strat.pnl >= 0 ? "+" : ""}${Math.round(strat.pnl).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Quality breakdown */}
        <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg overflow-hidden flex flex-col">
          <div className="border-b border-[#1A1A1E] bg-[#0C0C0E] px-4 py-2.5 text-[10px] font-bold text-[#A3A3A3] uppercase tracking-wider">
            Performance By Setup Quality
          </div>
          <div className="divide-y divide-[#131316] px-4 flex-grow flex flex-col justify-around">
            {qualityStats.map((q) => (
              <div key={q.name} className="py-3 flex justify-between items-center text-[11px]">
                <div className="flex flex-col">
                  <span className={`font-bold text-xs uppercase ${
                    q.name === "S" ? "text-terminal-amber" : q.name === "A" ? "text-[#00C805]" : "text-terminal-purple"
                  }`}>{q.name} Grade Setup</span>
                  <span className="text-[9px] text-[#B5B5B5] font-semibold">{q.trades} trades | WR: {q.winRate.toFixed(0)}%</span>
                </div>
                <span className={`font-bold font-data ${q.pnl >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
                  {q.pnl >= 0 ? "+" : ""}${Math.round(q.pnl).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
