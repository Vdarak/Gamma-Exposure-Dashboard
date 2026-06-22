"use client"

import { useState, useEffect, useMemo } from "react"
import { TrendingUp, TrendingDown, Award, Activity, BarChart3, BookOpen, Shuffle, AlertCircle } from "lucide-react"
import type { JournalTrade } from "@/lib/backend-api"
import dynamic from "next/dynamic"

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false })

export function StrategyStatsDashboard() {
  const [journalTrades, setJournalTrades] = useState<JournalTrade[]>([])
  const [backtestResult, setBacktestResult] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        // 1. Fetch live journal trades from the backend
        const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '')
        const response = await fetch(`${BACKEND_URL}/api/journal/trades`)
        if (response.ok) {
          const json = await response.json()
          setJournalTrades(json.data || [])
        }

        // 2. Load latest backtest result from localStorage
        const cachedBacktest = localStorage.getItem('last_backtest_result')
        if (cachedBacktest) {
          try {
            setBacktestResult(JSON.parse(cachedBacktest))
          } catch (e) {
            console.error("Failed to parse cached backtest result", e)
          }
        }
      } catch (err: any) {
        console.error("Failed to load strategy statistics dashboard data", err)
        setError(err.message || "Failed to connect to data sources")
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  // Calculate Metrics for Journal Trades
  const journalMetrics = useMemo(() => {
    const closedTrades = journalTrades.filter(t => t.status === 'Closed')
    if (closedTrades.length === 0) {
      return {
        totalTrades: 0,
        netProfit: 0,
        winRate: 0,
        profitFactor: 0,
        avgPnl: 0,
        winningTrades: 0,
        losingTrades: 0
      }
    }

    let grossProfit = 0
    let grossLoss = 0
    let winningTrades = 0
    let losingTrades = 0
    let netProfit = 0

    closedTrades.forEach(t => {
      const pnl = parseFloat(t.pnl as any) || 0
      netProfit += pnl
      if (pnl > 0) {
        grossProfit += pnl
        winningTrades++
      } else {
        grossLoss += Math.abs(pnl)
        losingTrades++
      }
    })

    const winRate = (winningTrades / closedTrades.length) * 100
    const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss
    const avgPnl = netProfit / closedTrades.length

    return {
      totalTrades: closedTrades.length,
      netProfit,
      winRate,
      profitFactor,
      avgPnl,
      winningTrades,
      losingTrades
    }
  }, [journalTrades])

  // Process Equity Curves
  const equityCurves = useMemo(() => {
    const data: any[] = []

    // 1. Process Journal Equity Curve (cumulative balance starting at default $2566.19)
    const startBalance = 2566.19
    const sortedJournal = [...journalTrades]
      .filter(t => t.status === 'Closed')
      .sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime())

    if (sortedJournal.length > 0) {
      const journalX: string[] = []
      const journalY: number[] = []

      // Initial point
      const firstDate = new Date(sortedJournal[0].tradeDate)
      firstDate.setDate(firstDate.getDate() - 1)
      journalX.push(firstDate.toISOString().split('T')[0])
      journalY.push(startBalance)

      let currentBalance = startBalance
      sortedJournal.forEach(t => {
        currentBalance += parseFloat(t.pnl as any) || 0
        journalX.push(t.tradeDate)
        journalY.push(currentBalance)
      })

      data.push({
        x: journalX,
        y: journalY,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Live Trading Journal',
        line: { color: '#00C805', width: 2.5 },
        marker: { size: 5, color: '#00ff66' }
      })
    }

    // 2. Process Backtester Equity Curve
    if (backtestResult && backtestResult.equityCurve && backtestResult.equityCurve.length > 0) {
      const backtestX: string[] = []
      const backtestY: number[] = []

      backtestResult.equityCurve.forEach((pt: any) => {
        backtestX.push(pt.timestamp.split('T')[0])
        backtestY.push(pt.portfolioValue)
      })

      data.push({
        x: backtestX,
        y: backtestY,
        type: 'scatter',
        mode: 'lines',
        name: 'Backtest Run Simulation',
        line: { color: '#3399ff', width: 2, dash: 'dot' }
      })
    }

    return data
  }, [journalTrades, backtestResult])

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-black/60 min-h-[400px]">
        <div className="w-8 h-8 border-2 border-transparent border-t-terminal-green rounded-full animate-spin mb-4" />
        <span className="text-xs font-mono text-terminal-green uppercase tracking-widest">LOADING STRATEGY TERMINAL STATISTICS...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 w-full font-mono text-xs select-none">
      
      {/* ─── TITLE BANNER ─── */}
      <div className="glass-panel p-5 rounded-lg border border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-base font-bold font-display text-white tracking-wider flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-terminal-green" />
            UNIFIED PERFORMANCE STATS TERMINAL
          </h2>
          <p className="text-[#666] text-[10px] mt-0.5 uppercase">AI Quantitative Backtest Simulation vs Live Execution Log</p>
        </div>
        <span className="text-[10.5px] bg-[#121215] border border-[#25252E] text-terminal-green px-3 py-1 rounded font-bold">
          CONFLUENCE METRICS ACTIVE
        </span>
      </div>

      {/* ─── SUMMARY CARDS GRID ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* JOURNAL STATS BADGE */}
        <div className="glass-panel p-5 rounded-lg border border-white/5 bg-black/40 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs font-bold text-white tracking-wider flex items-center gap-1.5 font-display">
              <BookOpen className="w-4 h-4 text-terminal-green" />
              LIVE JOURNAL EXECUTION
            </h3>
            <span className="text-[10px] text-terminal-green font-bold">LIVE SNAPSHOT</span>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-2">
            <div className="bg-black/50 border border-white/5 p-3 rounded">
              <span className="text-[9px] text-[#666] uppercase">Net Profit</span>
              <div className={`text-base font-bold flex items-center gap-1.5 mt-0.5 ${journalMetrics.netProfit >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                {journalMetrics.netProfit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                ${journalMetrics.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div className="bg-black/50 border border-white/5 p-3 rounded">
              <span className="text-[9px] text-[#666] uppercase">Win Rate</span>
              <div className="text-base font-bold text-white mt-0.5">
                {journalMetrics.winRate.toFixed(1)}%
              </div>
            </div>

            <div className="bg-black/50 border border-white/5 p-3 rounded">
              <span className="text-[9px] text-[#666] uppercase">Profit Factor</span>
              <div className="text-base font-bold text-white mt-0.5">
                {journalMetrics.profitFactor.toFixed(2)}
              </div>
            </div>

            <div className="bg-black/50 border border-white/5 p-3 rounded">
              <span className="text-[9px] text-[#666] uppercase">Total Trades</span>
              <div className="text-base font-bold text-[#3399ff] mt-0.5">
                {journalMetrics.totalTrades} ({journalMetrics.winningTrades}W - {journalMetrics.losingTrades}L)
              </div>
            </div>
          </div>
        </div>

        {/* BACKTEST RUN BADGE */}
        <div className="glass-panel p-5 rounded-lg border border-white/5 bg-black/40 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs font-bold text-white tracking-wider flex items-center gap-1.5 font-display">
              <Activity className="w-4 h-4 text-[#3399ff]" />
              SIMULATED RUN BACKTESTER
            </h3>
            {backtestResult ? (
              <span className="text-[10px] text-[#3399ff] font-bold">TICKER: {backtestResult.ticker}</span>
            ) : (
              <span className="text-[10px] text-[#555] font-bold">NO ACTIVE RUN</span>
            )}
          </div>

          {backtestResult ? (
            <div className="grid grid-cols-2 gap-4 mt-2">
              <div className="bg-black/50 border border-white/5 p-3 rounded">
                <span className="text-[9px] text-[#666] uppercase">Total Return</span>
                <div className={`text-base font-bold flex items-center gap-1.5 mt-0.5 ${backtestResult.totalPnl >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                  {backtestResult.totalPnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  ${backtestResult.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>

              <div className="bg-black/50 border border-white/5 p-3 rounded">
                <span className="text-[9px] text-[#666] uppercase">Win Rate</span>
                <div className="text-base font-bold text-white mt-0.5">
                  {backtestResult.winRate.toFixed(1)}%
                </div>
              </div>

              <div className="bg-black/50 border border-white/5 p-3 rounded">
                <span className="text-[9px] text-[#666] uppercase">Profit Factor</span>
                <div className="text-base font-bold text-white mt-0.5">
                  {backtestResult.profitFactor.toFixed(2)}
                </div>
              </div>

              <div className="bg-black/50 border border-white/5 p-3 rounded">
                <span className="text-[9px] text-[#666] uppercase">Max Drawdown</span>
                <div className="text-base font-bold text-terminal-red mt-0.5">
                  -{backtestResult.maxDrawdownPercent.toFixed(1)}%
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 border border-white/5 bg-black/20 rounded text-center">
              <AlertCircle className="w-8 h-8 text-[#555] mb-2" />
              <p className="text-[11px] text-[#666]">
                No recent backtest simulation found. Go to the "Backtest Engine" tab to run an options backtest to compare logs.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─── COMPARATIVE EQUITY CURVE CHART ─── */}
      <div className="glass-panel p-5 rounded-lg border border-white/5 flex flex-col gap-4">
        <h3 className="text-xs font-bold text-white tracking-wider flex items-center gap-1.5 font-display">
          <Shuffle className="w-4 h-4 text-terminal-green" />
          COMPARATIVE EQUITY VALUE CURVES
        </h3>

        {equityCurves.length > 0 ? (
          <div className="w-full h-[380px] bg-black rounded overflow-hidden">
            <Plot
              data={equityCurves}
              layout={{
                autosize: true,
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: '#B5B5B5', family: 'monospace', size: 10 },
                margin: { l: 60, r: 20, b: 40, t: 20 },
                hovermode: 'closest',
                xaxis: {
                  gridcolor: '#131316',
                  zerolinecolor: '#131316',
                  type: 'date'
                },
                yaxis: {
                  gridcolor: '#131316',
                  zerolinecolor: '#131316',
                  title: 'Capital ($)'
                },
                legend: {
                  x: 0.02,
                  y: 0.98,
                  bgcolor: 'rgba(0,0,0,0.8)',
                  bordercolor: 'rgba(255,255,255,0.05)',
                  borderwidth: 1
                }
              }}
              useResizeHandler
              style={{ width: "100%", height: "100%" }}
              config={{ displayModeBar: false, responsive: true }}
            />
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center border border-white/5 bg-black/20 rounded text-[#555]">
            Accumulating trading journal and backtester statistics to plot curve...
          </div>
        )}
      </div>

      {/* ─── DETAILED STATS COMPARISON MATRIX ─── */}
      <div className="glass-panel p-5 rounded-lg border border-white/5 flex flex-col gap-4">
        <h3 className="text-xs font-bold text-white tracking-wider flex items-center gap-1.5 font-display">
          <Award className="w-4 h-4 text-terminal-green" />
          PERFORMANCE COMPARISON MATRIX
        </h3>

        <div className="overflow-x-auto border border-white/5 rounded">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-white/10 font-bold uppercase text-[9px] text-[#888]">
                <th className="p-3">Performance Metric</th>
                <th className="p-3 text-terminal-green">Live Journal Log</th>
                <th className="p-3 text-[#3399ff]">Simulated Backtester</th>
                <th className="p-3">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <tr>
                <td className="p-3 font-semibold text-[#888]">Win Rate</td>
                <td className="p-3 text-white font-bold">{journalMetrics.winRate.toFixed(1)}%</td>
                <td className="p-3 text-white">{backtestResult ? `${backtestResult.winRate.toFixed(1)}%` : 'N/A'}</td>
                <td className="p-3 text-[#949494]">
                  {backtestResult ? `${(journalMetrics.winRate - backtestResult.winRate).toFixed(1)}%` : 'N/A'}
                </td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-[#888]">Profit Factor</td>
                <td className="p-3 text-white font-bold">{journalMetrics.profitFactor.toFixed(2)}</td>
                <td className="p-3 text-white">{backtestResult ? backtestResult.profitFactor.toFixed(2) : 'N/A'}</td>
                <td className="p-3 text-[#949494]">
                  {backtestResult ? (journalMetrics.profitFactor - backtestResult.profitFactor).toFixed(2) : 'N/A'}
                </td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-[#888]">Total Executed Trades</td>
                <td className="p-3 text-white font-bold">{journalMetrics.totalTrades}</td>
                <td className="p-3 text-white">{backtestResult ? backtestResult.totalTrades : 'N/A'}</td>
                <td className="p-3 text-[#949494]">
                  {backtestResult ? (journalMetrics.totalTrades - backtestResult.totalTrades) : 'N/A'}
                </td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-[#888]">Average PnL per Trade</td>
                <td className="p-3 text-white font-bold">
                  ${journalMetrics.avgPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="p-3 text-white">
                  {backtestResult ? `$${backtestResult.avgPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A'}
                </td>
                <td className="p-3 text-[#949494]">
                  {backtestResult ? `$${(journalMetrics.avgPnl - backtestResult.avgPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
