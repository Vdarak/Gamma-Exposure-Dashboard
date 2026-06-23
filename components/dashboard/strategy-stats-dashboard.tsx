"use client"

import { useState, useEffect, useMemo } from "react"
import { TrendingUp, TrendingDown, Award, Activity, BarChart3, BookOpen, Shuffle, AlertCircle, ChevronDown, ChevronUp, RefreshCw, FileText, Database } from "lucide-react"
import type { JournalTrade } from "@/lib/backend-api"
import dynamic from "next/dynamic"

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false })

export function StrategyStatsDashboard() {
  const [journalTrades, setJournalTrades] = useState<JournalTrade[]>([])
  const [backtestResult, setBacktestResult] = useState<any>(null)
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [expandedSuggestionId, setExpandedSuggestionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadData(showSpinner = true) {
    try {
      if (showSpinner) setLoading(true)
      else setRefreshing(true)
      
      const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '')
      
      // 1. Fetch live journal trades from the backend
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

      // 3. Fetch suggestion snapshots history
      const suggestionsResponse = await fetch(`${BACKEND_URL}/api/suggestions/history?ticker=SPX`)
      if (suggestionsResponse.ok) {
        const sJson = await suggestionsResponse.json()
        setSuggestions(sJson.data || [])
      }
    } catch (err: any) {
      console.error("Failed to load strategy statistics dashboard data", err)
      setError(err.message || "Failed to connect to data sources")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
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

      {/* ─── 0DTE SUGGESTION HISTORY TRACKER & INSTITUTIONAL PRINTS ─── */}
      <div className="glass-panel p-5 rounded-lg border border-white/5 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-xs font-bold text-white tracking-wider flex items-center gap-1.5 font-display">
              <Database className="w-4 h-4 text-terminal-green" />
              0DTE SETTLEBOMB SUGGESTIONS HISTORY
            </h3>
            <p className="text-[#666] text-[9px] uppercase mt-0.5 font-mono">Historical 15-minute engine logs and option chain prints</p>
          </div>
          <button 
            onClick={() => loadData(false)}
            disabled={refreshing}
            className="text-[9px] border border-[#25252E] hover:border-terminal-green text-terminal-green px-2.5 py-1 rounded bg-[#121215] transition-all uppercase flex items-center gap-1.5 font-mono"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'REFRESHING...' : 'REFRESH LOGS'}
          </button>
        </div>

        {suggestions.length > 0 ? (
          <div className="flex flex-col gap-3 font-mono">
            {suggestions.map((s) => {
              const isExpanded = expandedSuggestionId === s.id;
              const timestampStr = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) + ' ' + new Date(s.timestamp).toLocaleDateString([], { month: 'short', day: '2-digit' });
              
              let recordedLegs: any = null;
              if (s.recorded_legs) {
                try {
                  recordedLegs = typeof s.recorded_legs === 'string' ? JSON.parse(s.recorded_legs) : s.recorded_legs;
                } catch (e) {
                  console.error("Failed to parse recorded legs for suggestion " + s.id, e);
                }
              }

              return (
                <div 
                  key={s.id} 
                  className={`border rounded transition-all duration-200 ${isExpanded ? 'border-terminal-green bg-black/60' : 'border-white/5 bg-black/20 hover:border-white/10'}`}
                >
                  {/* Summary Bar */}
                  <div 
                    onClick={() => setExpandedSuggestionId(isExpanded ? null : s.id)}
                    className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-[#666]">{timestampStr}</span>
                      <div className="flex flex-col">
                        <span className="font-bold text-white tracking-wide">{s.title}</span>
                        <span className="text-[10px] text-terminal-green font-bold">SPOT: ${Number(s.spot_price).toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex gap-2">
                        <span className="bg-[#121215] border border-[#25252E] px-2 py-0.5 rounded text-[9px] uppercase text-[#888]">
                          TYPE: {s.suggestion_type}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${s.ppi >= 55 ? 'bg-terminal-green/10 text-terminal-green border border-terminal-green/20' : 'bg-white/5 text-[#888] border border-white/5'}`}>
                          PPI: {s.ppi}%
                        </span>
                        <span className="bg-[#121215] border border-[#25252E] px-2 py-0.5 rounded text-[9px] text-[#3399ff]">
                          CONF: {s.confidence_score}%
                        </span>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-white" /> : <ChevronDown className="w-4 h-4 text-[#555]" />}
                    </div>
                  </div>

                  {/* Expanded Detailed View */}
                  {isExpanded && (
                    <div className="border-t border-white/5 p-4 flex flex-col gap-4 bg-black/40">
                      
                      {/* Strategy Description & Details */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] text-[#666] uppercase font-bold">Strategy Description</span>
                          <p className="text-white leading-relaxed text-[11px] font-sans">{s.description}</p>
                        </div>
                        <div className="flex flex-col gap-2 bg-black/50 border border-white/5 p-3 rounded text-[10px]">
                          <div className="flex justify-between">
                            <span className="text-[#666] uppercase text-[9px]">Entry Trigger:</span>
                            <span className="text-white font-bold">{s.entry_trigger || 'N/A'}</span>
                          </div>
                          <div className="flex justify-between border-t border-white/5 pt-2">
                            <span className="text-[#666] uppercase text-[9px]">Risk/Reward Parameters:</span>
                            <span className="text-terminal-green font-bold">{s.risk_reward || 'N/A'}</span>
                          </div>
                          <div className="flex justify-between border-t border-white/5 pt-2">
                            <span className="text-[#666] uppercase text-[9px]">Target Striking Range:</span>
                            <span className="text-white font-bold">{s.strikes}</span>
                          </div>
                        </div>
                      </div>

                      {/* Institutional Prints */}
                      {recordedLegs ? (
                        <div className="flex flex-col gap-4 border-t border-white/5 pt-4">
                          
                          {/* Recommended Strategy Legs */}
                          {recordedLegs.strategy_legs && recordedLegs.strategy_legs.length > 0 && (
                            <div className="flex flex-col gap-2">
                              <span className="text-[10px] text-[#3399ff] uppercase font-bold flex items-center gap-1">
                                <FileText className="w-3.5 h-3.5" />
                                Recommended Strategy Leg Prints
                              </span>
                              <div className="overflow-x-auto border border-white/5 rounded">
                                <table className="w-full text-left border-collapse text-[10px]">
                                  <thead>
                                    <tr className="bg-white/5 border-b border-white/10 font-bold uppercase text-[9px] text-[#888]">
                                      <th className="p-2">Leg Action</th>
                                      <th className="p-2">Strike</th>
                                      <th className="p-2">Type</th>
                                      <th className="p-2 text-right">Bid</th>
                                      <th className="p-2 text-right">Ask</th>
                                      <th className="p-2 text-right">Mid</th>
                                      <th className="p-2 text-right">IV</th>
                                      <th className="p-2 text-right">Delta</th>
                                      <th className="p-2 text-right">Gamma</th>
                                      <th className="p-2 text-right">Vol</th>
                                      <th className="p-2 text-right">OI</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/5">
                                    {recordedLegs.strategy_legs.map((leg: any, idx: number) => {
                                      const c = leg.contract || leg;
                                      return (
                                        <tr key={idx} className="hover:bg-white/5">
                                          <td className="p-2 font-bold">
                                            <span className={`px-1.5 py-0.5 rounded text-[8px] ${leg.action === 'BUY' ? 'bg-terminal-green/10 text-terminal-green border border-terminal-green/20' : 'bg-terminal-red/10 text-terminal-red border border-terminal-red/20'}`}>
                                              {leg.action} {leg.ratio || 1}x
                                            </span>
                                          </td>
                                          <td className="p-2 font-bold text-white">{c.strike}</td>
                                          <td className="p-2">
                                            <span className={`font-bold ${c.type === 'C' ? 'text-terminal-green' : 'text-terminal-red'}`}>
                                              {c.type === 'C' ? 'Call' : 'Put'}
                                            </span>
                                          </td>
                                          <td className="p-2 text-right">${Number(c.bid).toFixed(2)}</td>
                                          <td className="p-2 text-right">${Number(c.ask).toFixed(2)}</td>
                                          <td className="p-2 text-right text-white">${Number(c.mid_price || (c.bid + c.ask) / 2).toFixed(2)}</td>
                                          <td className="p-2 text-right text-[#888]">{(Number(c.implied_volatility) * 100).toFixed(1)}%</td>
                                          <td className="p-2 text-right">{Number(c.delta).toFixed(3)}</td>
                                          <td className="p-2 text-right">{Number(c.gamma).toFixed(5)}</td>
                                          <td className="p-2 text-right text-[#888]">{c.volume}</td>
                                          <td className="p-2 text-right text-[#888]">{c.open_interest}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Long Single-Leg option prints */}
                          {recordedLegs.single_legs && (
                            <div className="flex flex-col gap-2">
                              <span className="text-[10px] text-terminal-green uppercase font-bold flex items-center gap-1">
                                <Database className="w-3.5 h-3.5" />
                                Long Single-Leg Gamma Option Candidates
                              </span>
                              <div className="overflow-x-auto border border-white/5 rounded">
                                <table className="w-full text-left border-collapse text-[10px]">
                                  <thead>
                                    <tr className="bg-white/5 border-b border-white/10 font-bold uppercase text-[9px] text-[#888]">
                                      <th className="p-2">Option Candidate</th>
                                      <th className="p-2">Strike</th>
                                      <th className="p-2">Type</th>
                                      <th className="p-2 text-right">Bid</th>
                                      <th className="p-2 text-right">Ask</th>
                                      <th className="p-2 text-right">Mid</th>
                                      <th className="p-2 text-right">IV</th>
                                      <th className="p-2 text-right">Delta</th>
                                      <th className="p-2 text-right">Gamma</th>
                                      <th className="p-2 text-right">Vol</th>
                                      <th className="p-2 text-right">OI</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/5 text-white/80">
                                    {Object.entries(recordedLegs.single_legs).map(([key, val]: any) => {
                                      if (!val) return null;
                                      const labelMap: Record<string, string> = {
                                        atm_call: 'ATM Long Call',
                                        atm_put: 'ATM Long Put',
                                        otm_25d_call: 'OTM 25Δ Call',
                                        otm_25d_put: 'OTM 25Δ Put',
                                        otm_15d_call: 'OTM 15Δ Call',
                                        otm_15d_put: 'OTM 15Δ Put',
                                      };
                                      return (
                                        <tr key={key} className="hover:bg-white/5">
                                          <td className="p-2 font-bold text-white">{labelMap[key] || key}</td>
                                          <td className="p-2 font-bold">{val.strike}</td>
                                          <td className="p-2">
                                            <span className={`font-bold ${val.type === 'C' ? 'text-terminal-green' : 'text-terminal-red'}`}>
                                              {val.type === 'C' ? 'Call' : 'Put'}
                                            </span>
                                          </td>
                                          <td className="p-2 text-right">${Number(val.bid).toFixed(2)}</td>
                                          <td className="p-2 text-right">${Number(val.ask).toFixed(2)}</td>
                                          <td className="p-2 text-right text-white">${Number(val.mid_price || (val.bid + val.ask) / 2).toFixed(2)}</td>
                                          <td className="p-2 text-right text-[#888]">{(Number(val.implied_volatility) * 100).toFixed(1)}%</td>
                                          <td className="p-2 text-right">{Number(val.delta).toFixed(3)}</td>
                                          <td className="p-2 text-right">{Number(val.gamma).toFixed(5)}</td>
                                          <td className="p-2 text-right text-[#888]">{val.volume}</td>
                                          <td className="p-2 text-right text-[#888]">{val.open_interest}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                        </div>
                      ) : (
                        <span className="text-[10px] text-[#666]">No detailed option prints recorded for this snapshot.</span>
                      )}

                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-[120px] flex flex-col items-center justify-center border border-white/5 bg-black/20 rounded text-[#555] p-4 text-center">
            <AlertCircle className="w-6 h-6 text-[#444] mb-2" />
            No suggestions history found for SPX. Check backend scheduler or record a manual print.
          </div>
        )}
      </div>
    </div>
  )
}
