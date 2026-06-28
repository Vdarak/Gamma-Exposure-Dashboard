"use client"

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Play, Plus, Trash2, ArrowUpRight, ArrowDownRight, Activity, Percent, Layers, Landmark, Info, FileSpreadsheet } from 'lucide-react';

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface PortfolioTesterDashboardProps {
  availableTickers: string[];
}

interface StrategyConfig {
  id: string;
  name: string;
  type: 'equity' | 'options';
  ticker: string;
  weight: number;
  template: 'buy_hold' | 'sma_crossover' | 'ema_crossover' | 'rsi_reversion' | 'straddle' | 'iron_condor' | 'atm_call';
}

export function PortfolioTesterDashboard({ availableTickers }: PortfolioTesterDashboardProps) {
  const [strategies, setStrategies] = useState<StrategyConfig[]>([
    {
      id: 'strat_1',
      name: 'SPY Buy & Hold',
      type: 'equity',
      ticker: 'SPY',
      weight: 50,
      template: 'buy_hold'
    },
    {
      id: 'strat_2',
      name: 'SPY Options Straddle',
      type: 'options',
      ticker: 'SPY',
      weight: 50,
      template: 'straddle'
    }
  ]);

  const [rebalanceFrequency, setRebalanceFrequency] = useState<string>('weekly');
  const [driftThresholdPercent, setDriftThresholdPercent] = useState<number>(5);
  const [initialCapital, setInitialCapital] = useState<number>(100000);
  const [startDate, setStartDate] = useState<string>('2023-01-01');
  const [endDate, setEndDate] = useState<string>('2023-06-30');
  const [benchmark, setBenchmark] = useState<string>('SPY');
  
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'trades'>('overview');

  const handleAddStrategy = () => {
    const nextId = `strat_${Date.now()}`;
    // Split remaining weight or set default
    const currentTotal = strategies.reduce((sum, s) => sum + s.weight, 0);
    const weight = Math.max(0, 100 - currentTotal);
    
    setStrategies([
      ...strategies,
      {
        id: nextId,
        name: `Strategy ${strategies.length + 1}`,
        type: 'equity',
        ticker: availableTickers[0] || 'SPY',
        weight: weight,
        template: 'buy_hold'
      }
    ]);
  };

  const handleDeleteStrategy = (id: string) => {
    setStrategies(strategies.filter(s => s.id !== id));
  };

  const handleUpdateStrategy = (id: string, updates: Partial<StrategyConfig>) => {
    setStrategies(strategies.map(s => {
      if (s.id === id) {
        const updated = { ...s, ...updates };
        if (updates.type === 'options') {
          updated.template = 'straddle'; // Default options template
        } else if (updates.type === 'equity' && s.type === 'options') {
          updated.template = 'buy_hold'; // Default equity template
        }
        return updated;
      }
      return s;
    }));
  };

  const handleRunPortfolio = async () => {
    // 1. Verify weights sum to 100
    const totalWeight = strategies.reduce((sum, s) => sum + s.weight, 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      toast.error(`Strategy weights must sum to exactly 100%. Current total: ${totalWeight}%`);
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);

    // 2. Build backend configs for each strategy based on selected template
    const formattedStrategies = strategies.map(s => {
      let subConfig: any = {};
      if (s.type === 'equity') {
        if (s.template === 'buy_hold') {
          subConfig = { timeframe: '1d', entryRules: { indicators: [] }, exitRules: { indicators: [] } };
        } else if (s.template === 'sma_crossover') {
          subConfig = {
            timeframe: '1d',
            indicators: [
              { type: 'sma', period1: 10 },
              { type: 'sma', period1: 50 }
            ],
            entryRules: {
              indicators: [
                { indicator1: 'sma_10', operator: 'crosses_above', indicator2: 'sma_50' }
              ]
            },
            exitRules: {
              indicators: [
                { indicator1: 'sma_10', operator: 'crosses_below', indicator2: 'sma_50' }
              ]
            }
          };
        } else if (s.template === 'ema_crossover') {
          subConfig = {
            timeframe: '1d',
            indicators: [
              { type: 'ema', period1: 9 },
              { type: 'ema', period1: 21 }
            ],
            entryRules: {
              indicators: [
                { indicator1: 'ema_9', operator: 'crosses_above', indicator2: 'ema_21' }
              ]
            },
            exitRules: {
              indicators: [
                { indicator1: 'ema_9', operator: 'crosses_below', indicator2: 'ema_21' }
              ]
            }
          };
        } else if (s.template === 'rsi_reversion') {
          subConfig = {
            timeframe: '1d',
            indicators: [{ type: 'rsi', period1: 14 }],
            entryRules: {
              indicators: [
                { indicator1: 'rsi_14', operator: 'less_than', indicator2: '30' }
              ]
            },
            exitRules: {
              indicators: [
                { indicator1: 'rsi_14', operator: 'greater_than', indicator2: '70' }
              ]
            }
          };
        }
      } else {
        // Options Strategies
        subConfig = {
          strategyClass: s.template === 'straddle' ? 'multileg' : s.template === 'iron_condor' ? 'multileg' : 'single-leg',
          takeProfitPercent: 50,
          stopLossPercent: 50
        };
      }

      return {
        id: s.id,
        name: s.name,
        type: s.type,
        ticker: s.ticker,
        weight: s.weight / 100.0,
        config: subConfig
      };
    });

    const payload = {
      strategies: formattedStrategies,
      rebalanceFrequency,
      driftThresholdPercent,
      initialCapital,
      startDate,
      endDate,
      benchmark,
      commission: 0.05,
      slippage: 0.1
    };

    try {
      const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');
      const res = await fetch(`${BACKEND_URL}/api/backtest/portfolio/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const json = await res.json();
      if (res.ok && json.success) {
        setResult(json.data);
        toast.success("Portfolio backtest executed successfully.");
      } else {
        throw new Error(json.detail || "Failed to execute portfolio backtest.");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred.");
      toast.error(err.message || "Simulation failed.");
    } finally {
      setIsRunning(false);
    }
  };

  // Extract variables for plotting
  const timestamps = result?.equityCurve?.map((p: any) => p.timestamp) || [];
  const navCurve = result?.equityCurve?.map((p: any) => p.portfolioReturn) || [];
  const benchmarkCurve = result?.equityCurve?.map((p: any) => p.benchmarkReturn) || [];
  
  // NAV Allocation breakdowns
  const cashCurve = result?.equityCurve?.map((p: any) => p.cash) || [];
  const equityValCurve = result?.equityCurve?.map((p: any) => p.equityValue) || [];
  const optionsValCurve = result?.equityCurve?.map((p: any) => p.optionsValue) || [];

  return (
    <div className="flex flex-col lg:flex-row h-full w-full min-h-0 bg-[#020203] font-mono text-xs text-[#E5E5E5] gap-4 p-4 overflow-y-auto lg:overflow-hidden">
      {/* LEFT PANEL: CONFIGURATION */}
      <div className="w-full lg:w-[40%] flex flex-col gap-4 flex-shrink-0 bg-[#08080A] border border-[#15151A] rounded p-4 h-fit max-h-full overflow-y-auto terminal-scrollbar">
        <div className="flex items-center justify-between border-b border-[#1A1A24] pb-2 mb-2">
          <span className="text-terminal-green font-bold text-sm tracking-wider">PORTFOLIO CONSTRUCTOR</span>
          <button
            onClick={handleRunPortfolio}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-terminal-green/10 hover:bg-terminal-green/20 text-terminal-green border border-terminal-green/30 hover:border-terminal-green rounded transition-all select-none uppercase font-bold text-[10px]"
          >
            {isRunning ? (
              <div className="w-3.5 h-3.5 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-terminal-green" /> Run Portfolio
              </>
            )}
          </button>
        </div>

        {/* Global Parameters */}
        <div className="grid grid-cols-2 gap-3 mb-2 bg-black/45 border border-[#15151A] p-3 rounded">
          <div className="flex flex-col gap-1">
            <span className="text-[#64748B] text-[9px] uppercase font-bold">Capital ($)</span>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(Number(e.target.value))}
              className="bg-[#111] border border-[#222] rounded p-1.5 focus:border-terminal-green/30 outline-none text-[#E5E5E5]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[#64748B] text-[9px] uppercase font-bold">Benchmark</span>
            <select
              value={benchmark}
              onChange={(e) => setBenchmark(e.target.value)}
              className="bg-[#111] border border-[#222] rounded p-1.5 focus:border-terminal-green/30 outline-none text-[#E5E5E5]"
            >
              <option value="SPY">SPY (S&P 500 ETF)</option>
              <option value="QQQ">QQQ (Nasdaq 100 ETF)</option>
              <option value="IWM">IWM (Russell 2000 ETF)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[#64748B] text-[9px] uppercase font-bold">Start Date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-[#111] border border-[#222] rounded p-1.5 focus:border-terminal-green/30 outline-none text-[#E5E5E5]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[#64748B] text-[9px] uppercase font-bold">End Date</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-[#111] border border-[#222] rounded p-1.5 focus:border-terminal-green/30 outline-none text-[#E5E5E5]"
            />
          </div>
        </div>

        {/* Rebalancing & Risk parameters */}
        <div className="grid grid-cols-2 gap-3 mb-2 bg-black/45 border border-[#15151A] p-3 rounded">
          <div className="flex flex-col gap-1">
            <span className="text-[#64748B] text-[9px] uppercase font-bold">Rebalance Freq</span>
            <select
              value={rebalanceFrequency}
              onChange={(e) => setRebalanceFrequency(e.target.value)}
              className="bg-[#111] border border-[#222] rounded p-1.5 focus:border-terminal-green/30 outline-none text-[#E5E5E5]"
            >
              <option value="none">No Rebalancing</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[#64748B] text-[9px] uppercase font-bold">Drift Threshold</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={driftThresholdPercent}
                onChange={(e) => setDriftThresholdPercent(Number(e.target.value))}
                min="0"
                max="20"
                className="w-full bg-[#111] border border-[#222] rounded p-1.5 focus:border-terminal-green/30 outline-none text-[#E5E5E5]"
              />
              <span className="text-[#64748B] font-bold">%</span>
            </div>
          </div>
        </div>

        {/* Strategies Allocations */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-terminal-green font-bold text-xs uppercase">Strategies</span>
            <button
              onClick={handleAddStrategy}
              className="flex items-center gap-1 px-2.5 py-1 bg-[#111] hover:bg-[#1A1A24] border border-[#222] hover:border-terminal-green rounded text-[10px] text-[#E5E5E5] font-bold transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> Add Strategy
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {strategies.map((strat, idx) => (
              <div key={strat.id} className="border border-[#1A1A24] bg-black/30 p-3 rounded flex flex-col gap-2 relative">
                <button
                  onClick={() => handleDeleteStrategy(strat.id)}
                  className="absolute top-2 right-2 text-[#555] hover:text-[#FF3B60] transition-colors"
                  title="Remove strategy"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <div className="flex flex-wrap gap-2 pr-6">
                  {/* Strategy Name */}
                  <input
                    type="text"
                    value={strat.name}
                    onChange={(e) => handleUpdateStrategy(strat.id, { name: e.target.value })}
                    className="bg-transparent border-b border-[#222] focus:border-terminal-green/30 outline-none text-[#E5E5E5] font-bold py-0.5 text-xs mr-2 flex-1"
                  />
                  
                  {/* Allocation Weight */}
                  <div className="flex items-center gap-1">
                    <span className="text-[#555] text-[9px] uppercase font-mono">Weight:</span>
                    <input
                      type="number"
                      value={strat.weight}
                      onChange={(e) => handleUpdateStrategy(strat.id, { weight: Number(e.target.value) })}
                      min="0"
                      max="100"
                      className="w-12 bg-[#111] border border-[#222] rounded p-1 text-center font-bold text-[#E5E5E5]"
                    />
                    <span className="text-[#555] font-bold">%</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-1">
                  {/* Asset class */}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#555] text-[9px]">Class</span>
                    <select
                      value={strat.type}
                      onChange={(e) => handleUpdateStrategy(strat.id, { type: e.target.value as any })}
                      className="bg-[#111] border border-[#222] rounded p-1 outline-none text-[#E5E5E5] text-[10px]"
                    >
                      <option value="equity">Equity</option>
                      <option value="options">Options (0DTE)</option>
                    </select>
                  </div>

                  {/* Ticker */}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#555] text-[9px]">Ticker</span>
                    <select
                      value={strat.ticker}
                      onChange={(e) => handleUpdateStrategy(strat.id, { ticker: e.target.value })}
                      className="bg-[#111] border border-[#222] rounded p-1 outline-none text-[#E5E5E5] text-[10px]"
                    >
                      {availableTickers.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {/* Template */}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[#555] text-[9px]">Template</span>
                    <select
                      value={strat.template}
                      onChange={(e) => handleUpdateStrategy(strat.id, { template: e.target.value as any })}
                      className="bg-[#111] border border-[#222] rounded p-1 outline-none text-[#E5E5E5] text-[10px]"
                    >
                      {strat.type === 'equity' ? (
                        <>
                          <option value="buy_hold">Buy & Hold</option>
                          <option value="sma_crossover">SMA Cross (10/50)</option>
                          <option value="ema_crossover">EMA Cross (9/21)</option>
                          <option value="rsi_reversion">RSI Mean Rev</option>
                        </>
                      ) : (
                        <>
                          <option value="straddle">Straddle</option>
                          <option value="iron_condor">Iron Condor</option>
                          <option value="atm_call">ATM Call</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: PERFORMANCE & METRICS */}
      <div className="flex-1 flex flex-col gap-4 bg-[#020203] min-h-0 overflow-y-auto lg:overflow-hidden">
        {/* Navigation Tabs */}
        <div className="border-b border-[#15151A] bg-[#08080A] flex items-center px-4 py-2 flex-shrink-0 font-mono">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 text-xs font-bold rounded transition-all border mr-2 ${
              activeTab === 'overview'
                ? 'bg-[#121215] text-terminal-green border-[#25252E] shadow-sm'
                : 'bg-transparent text-[#949494] border-transparent hover:text-[#888]'
            }`}
          >
            Overview & Performance
          </button>
          <button
            onClick={() => setActiveTab('trades')}
            className={`px-3 py-1.5 text-xs font-bold rounded transition-all border ${
              activeTab === 'trades'
                ? 'bg-[#121215] text-terminal-green border-[#25252E] shadow-sm'
                : 'bg-transparent text-[#949494] border-transparent hover:text-[#888]'
            }`}
          >
            Unified Trade Log
          </button>
        </div>

        {/* Tab contents */}
        {error && (
          <div className="bg-[#FF3B60]/10 border border-[#FF3B60]/30 text-[#FF3B60] p-4 rounded text-xs leading-relaxed font-mono">
            {error}
          </div>
        )}

        {result ? (
          activeTab === 'overview' ? (
            <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto p-1 pr-2 terminal-scrollbar">
              {/* Metrics Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <div className="bg-[#08080A] border border-[#15151A] p-3 rounded flex flex-col gap-1 font-mono">
                  <div className="flex items-center gap-1.5 text-[#64748B]">
                    <Landmark className="w-3.5 h-3.5" />
                    <span className="text-[9px] uppercase font-bold">Total Return</span>
                  </div>
                  <span className={`text-base font-bold ${result.totalReturnPercent >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                    {result.totalReturnPercent >= 0 ? '+' : ''}{result.totalReturnPercent.toFixed(2)}%
                  </span>
                </div>

                <div className="bg-[#08080A] border border-[#15151A] p-3 rounded flex flex-col gap-1 font-mono">
                  <div className="flex items-center gap-1.5 text-[#64748B]">
                    <Percent className="w-3.5 h-3.5" />
                    <span className="text-[9px] uppercase font-bold">CAGR (Ann.)</span>
                  </div>
                  <span className={`text-base font-bold ${result.cagr >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                    {result.cagr >= 0 ? '+' : ''}{result.cagr.toFixed(2)}%
                  </span>
                </div>

                <div className="bg-[#08080A] border border-[#15151A] p-3 rounded flex flex-col gap-1 font-mono">
                  <div className="flex items-center gap-1.5 text-[#64748B]">
                    <ArrowDownRight className="w-3.5 h-3.5" />
                    <span className="text-[9px] uppercase font-bold">Max Drawdown</span>
                  </div>
                  <span className="text-base font-bold text-terminal-red">
                    -{result.maxDrawdownPercent.toFixed(2)}%
                  </span>
                </div>

                <div className="bg-[#08080A] border border-[#15151A] p-3 rounded flex flex-col gap-1 font-mono">
                  <div className="flex items-center gap-1.5 text-[#64748B]">
                    <Activity className="w-3.5 h-3.5" />
                    <span className="text-[9px] uppercase font-bold">Sharpe Ratio</span>
                  </div>
                  <span className="text-base font-bold text-[#E5E5E5]">
                    {result.sharpeRatio.toFixed(2)}
                  </span>
                </div>

                <div className="bg-[#08080A] border border-[#15151A] p-3 rounded flex flex-col gap-1 font-mono">
                  <div className="flex items-center gap-1.5 text-[#64748B]">
                    <Layers className="w-3.5 h-3.5" />
                    <span className="text-[9px] uppercase font-bold">Portfolio Beta</span>
                  </div>
                  <span className="text-base font-bold text-[#E5E5E5]">
                    {result.beta.toFixed(2)}
                  </span>
                </div>

                <div className="bg-[#08080A] border border-[#15151A] p-3 rounded flex flex-col gap-1 font-mono">
                  <div className="flex items-center gap-1.5 text-[#64748B]">
                    <Plus className="w-3.5 h-3.5" />
                    <span className="text-[9px] uppercase font-bold">Alpha (Ann.)</span>
                  </div>
                  <span className={`text-base font-bold ${result.alphaPercent >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                    {result.alphaPercent >= 0 ? '+' : ''}{result.alphaPercent.toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* NAV Return Chart */}
              <div className="bg-[#08080A] border border-[#15151A] rounded p-4 h-[300px] flex-shrink-0">
                <Plot
                  data={[
                    {
                      x: timestamps,
                      y: navCurve,
                      type: 'scatter',
                      mode: 'lines',
                      name: 'Portfolio NAV',
                      line: { color: result.totalReturnPercent >= 0 ? '#00C805' : '#FF3B60', width: 2 }
                    },
                    {
                      x: timestamps,
                      y: benchmarkCurve,
                      type: 'scatter',
                      mode: 'lines',
                      name: `${result.benchmarkTicker} Benchmark`,
                      line: { color: '#64748B', width: 1.5, dash: 'dash' }
                    }
                  ]}
                  layout={{
                    autosize: true,
                    margin: { l: 40, r: 20, t: 10, b: 40 },
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)',
                    xaxis: {
                      gridcolor: '#15151A',
                      tickfont: { color: '#888', family: 'monospace', size: 9 },
                    },
                    yaxis: {
                      gridcolor: '#15151A',
                      tickfont: { color: '#888', family: 'monospace', size: 9 },
                      ticksuffix: '%'
                    },
                    legend: { font: { color: '#E5E5E5', family: 'monospace', size: 9 }, bgcolor: 'rgba(0,0,0,0)' }
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  className="w-full h-full"
                />
              </div>

              {/* NAV Asset Breakdown Chart (Cash, Spot, Options) */}
              <div className="bg-[#08080A] border border-[#15151A] rounded p-4 h-[250px] flex-shrink-0">
                <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-2">NAV Allocation Breakdown (Cash / Equities / Options)</span>
                <Plot
                  data={[
                    {
                      x: timestamps,
                      y: cashCurve,
                      type: 'scatter',
                      mode: 'lines',
                      name: 'Cash Balance',
                      stackgroup: 'one',
                      line: { color: '#3B82F6', width: 1 }
                    },
                    {
                      x: timestamps,
                      y: equityValCurve,
                      type: 'scatter',
                      mode: 'lines',
                      name: 'Equity Holdings',
                      stackgroup: 'one',
                      line: { color: '#10B981', width: 1 }
                    },
                    {
                      x: timestamps,
                      y: optionsValCurve,
                      type: 'scatter',
                      mode: 'lines',
                      name: 'Options Contract Val',
                      stackgroup: 'one',
                      line: { color: '#8B5CF6', width: 1 }
                    }
                  ]}
                  layout={{
                    autosize: true,
                    margin: { l: 45, r: 20, t: 10, b: 40 },
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)',
                    xaxis: {
                      gridcolor: '#15151A',
                      tickfont: { color: '#888', family: 'monospace', size: 9 },
                    },
                    yaxis: {
                      gridcolor: '#15151A',
                      tickfont: { color: '#888', family: 'monospace', size: 9 },
                      prefix: '$'
                    },
                    legend: { font: { color: '#E5E5E5', family: 'monospace', size: 9 }, bgcolor: 'rgba(0,0,0,0)' }
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  className="w-full h-full"
                />
              </div>
            </div>
          ) : (
            /* Trades Log */
            <div className="flex-1 min-h-0 bg-[#08080A] border border-[#15151A] rounded overflow-hidden flex flex-col font-mono">
              <div className="overflow-y-auto terminal-scrollbar flex-1">
                <table className="w-full text-left border-collapse text-[10px]">
                  <thead>
                    <tr className="bg-[#121215] text-[#64748B] border-b border-[#1A1A24] font-bold">
                      <th className="p-2.5">STRATEGY</th>
                      <th className="p-2.5">TICKER</th>
                      <th className="p-2.5">DIR</th>
                      <th className="p-2.5">ENTRY DATE</th>
                      <th className="p-2.5">ENTRY PRICE</th>
                      <th className="p-2.5">EXIT DATE</th>
                      <th className="p-2.5">EXIT PRICE</th>
                      <th className="p-2.5">SIZE (WT)</th>
                      <th className="p-2.5">PNL</th>
                      <th className="p-2.5">RET %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades && result.trades.length > 0 ? (
                      result.trades.map((tr: any, i: number) => (
                        <tr key={i} className="border-b border-[#15151A] hover:bg-black/45 transition-colors">
                          <td className="p-2.5 text-[#E5E5E5] font-bold">{tr.strategyName}</td>
                          <td className="p-2.5 uppercase text-[#888]">{tr.ticker}</td>
                          <td className={`p-2.5 font-bold ${tr.direction === 'Long' ? 'text-terminal-green' : 'text-terminal-red'}`}>
                            {tr.direction.toUpperCase()}
                          </td>
                          <td className="p-2.5 text-[#888]">{tr.entryDate}</td>
                          <td className="p-2.5">${tr.entryPrice.toFixed(2)}</td>
                          <td className="p-2.5 text-[#888]">{tr.exitDate}</td>
                          <td className="p-2.5">${tr.exitPrice.toFixed(2)}</td>
                          <td className="p-2.5">{tr.size.toFixed(2)}</td>
                          <td className={`p-2.5 font-bold ${tr.pnl >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                            {tr.pnl >= 0 ? '+' : ''}${tr.pnl.toFixed(2)}
                          </td>
                          <td className={`p-2.5 font-bold ${tr.returnPct >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                            {tr.returnPct >= 0 ? '+' : ''}{tr.returnPct.toFixed(2)}%
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={10} className="p-4 text-center text-[#555]">
                          No trades executed during the simulation period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-[#1A1A24] bg-black/10 rounded gap-3 p-8 select-none">
            <Layers className="w-12 h-12 text-[#333]" />
            <div className="flex flex-col items-center gap-1 font-mono text-center">
              <span className="font-bold text-[#64748B] text-xs">PORTFOLIO RESULTS PENDING</span>
              <span className="text-[#444] text-[10px]">Configure your strategy splits on the left and run the backtest to simulate allocations.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
