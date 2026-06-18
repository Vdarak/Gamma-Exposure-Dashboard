"use client"

import React, { useState, useEffect } from 'react';
import { BacktestConfig, BacktestResult, IndicatorConfig, IndicatorCondition } from '../../backend/src/backtester/types';
import { BacktestConfigForm } from './backtest-config-form';
import { BacktestMetricsGrid } from './backtest-metrics-grid';
import { BacktestCharts } from './backtest-charts';
import { BacktestTradeLog } from './backtest-trade-log';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';

export function BacktestDashboard() {
  const [availableTickers, setAvailableTickers] = useState<string[]>([]);
  const [isLoadingTickers, setIsLoadingTickers] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  // Form states
  const [ticker, setTicker] = useState('SPY');
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-12-31');
  const [initialCapital, setInitialCapital] = useState(10000);
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | '30m' | '1h' | '1d'>('1d');
  const [commission, setCommission] = useState(0.50);
  const [slippagePercent, setSlippagePercent] = useState(0.05);

  // Indicators list
  const [indicators, setIndicators] = useState<IndicatorConfig[]>([
    { type: 'sma', period1: 20 },
    { type: 'sma', period1: 50 },
    { type: 'rsi', period1: 14 }
  ]);

  // Entry / Exit rules
  const [entryRules, setEntryRules] = useState<IndicatorCondition[]>([
    { indicator1: 'close', operator: 'crosses_above', indicator2: 'sma_20' }
  ]);
  const [exitRules, setExitRules] = useState<IndicatorCondition[]>([
    { indicator1: 'close', operator: 'crosses_below', indicator2: 'sma_20' }
  ]);

  // Risk management parameters
  const [stopLossPercent, setStopLossPercent] = useState<number | undefined>(2.0);
  const [trailingStopPercent, setTrailingStopPercent] = useState<number | undefined>(undefined);
  const [takeProfitPercent, setTakeProfitPercent] = useState<number | undefined>(5.0);
  const [timeBasedExitDays, setTimeBasedExitDays] = useState<number | undefined>(undefined);

  // Fetch available tickers on load
  useEffect(() => {
    async function fetchTickers() {
      try {
        setIsLoadingTickers(true);
        const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
        const response = await fetch(`${BACKEND_URL}/api/backtest/tickers`);
        if (response.ok) {
          const json = await response.json();
          if (json.success && json.data.length > 0) {
            setAvailableTickers(json.data);
            setTicker(json.data[0]); // Default to first available ticker
          }
        }
      } catch (err) {
        console.error("Error loading backtest tickers:", err);
      } finally {
        setIsLoadingTickers(false);
      }
    }
    fetchTickers();
  }, []);

  const handleRunBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRunning(true);
    setError(null);
    setResult(null);

    const config: BacktestConfig = {
      ticker,
      assetClass: 'equity',
      startDate,
      endDate,
      initialCapital,
      timeframe,
      commission,
      slippagePercent,
      indicators,
      entryRules: { indicators: entryRules },
      exitRules: {
        stopLossPercent: stopLossPercent || undefined,
        trailingStopPercent: trailingStopPercent || undefined,
        takeProfitPercent: takeProfitPercent || undefined,
        timeBasedExitDays: timeBasedExitDays || undefined,
        indicators: exitRules
      }
    };

    try {
      const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
      const response = await fetch(`${BACKEND_URL}/api/backtest/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      const json = await response.json();
      if (response.ok && json.success) {
        setResult(json.data);
        toast.success(`Backtest completed for ${ticker}!`);
      } else {
        setError(json.error || 'Failed to complete backtest');
        toast.error(json.error || 'Backtest failed');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Network error occurred connecting to backtest engine');
      toast.error('Network connection error');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 bg-[#020203] overflow-y-auto md:overflow-hidden select-none">
      {/* ─── LEFT PANEL: CONFIGURATION FORM ─── */}
      <aside className="w-full md:w-[350px] bg-[#08080A] border-r border-[#15151A] flex flex-col flex-shrink-0 md:h-full overflow-y-auto terminal-scrollbar">
        <div className="p-4 border-b border-[#15151A] bg-[#0A0A0C]">
          <h2 className="text-xs font-bold font-mono tracking-widest text-[#E5E5E5] uppercase">STRATEGY STUDIO</h2>
          <p className="text-[10px] font-mono text-[#555] mt-1">Configure equity backtests & indicator triggers</p>
        </div>
        
        <BacktestConfigForm
          availableTickers={availableTickers}
          isLoadingTickers={isLoadingTickers}
          ticker={ticker}
          setTicker={setTicker}
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          initialCapital={initialCapital}
          setInitialCapital={setInitialCapital}
          timeframe={timeframe}
          setTimeframe={setTimeframe}
          commission={commission}
          setCommission={setCommission}
          slippagePercent={slippagePercent}
          setSlippagePercent={setSlippagePercent}
          indicators={indicators}
          setIndicators={setIndicators}
          entryRules={entryRules}
          setEntryRules={setEntryRules}
          exitRules={exitRules}
          setExitRules={setExitRules}
          stopLossPercent={stopLossPercent}
          setStopLossPercent={setStopLossPercent}
          trailingStopPercent={trailingStopPercent}
          setTrailingStopPercent={setTrailingStopPercent}
          takeProfitPercent={takeProfitPercent}
          setTakeProfitPercent={setTakeProfitPercent}
          timeBasedExitDays={timeBasedExitDays}
          setTimeBasedExitDays={setTimeBasedExitDays}
          onSubmit={handleRunBacktest}
          isRunning={isRunning}
        />
      </aside>

      {/* ─── RIGHT PANEL: WORKSPACE / REPORT ─── */}
      <section className="flex-1 flex flex-col min-w-0 md:h-full bg-[#020203] relative overflow-y-auto md:overflow-hidden">
        {isRunning && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
            <div className="flex flex-col items-center gap-4 text-terminal-green">
              <div className="w-10 h-10 border-4 border-transparent border-t-terminal-green rounded-full animate-spin" />
              <div className="text-center font-mono">
                <span className="text-xs tracking-widest uppercase animate-pulse">RUNNING SIMULATION ENGINE...</span>
                <p className="text-[10px] text-[#444] mt-1">Calculating indicators & executing broker rules</p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-md w-full border border-terminal-red/25 bg-terminal-red/5 rounded-lg p-5 flex flex-col gap-4 font-mono">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-terminal-red animate-pulse" />
                <span className="text-xs font-bold text-terminal-red">ENGINE EXCEPTION</span>
              </div>
              <p className="text-[11px] text-[#888] leading-relaxed">
                {error}
              </p>
            </div>
          </div>
        )}

        {!result && !error && !isRunning && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[#949494] font-mono">
            <div className="w-12 h-12 rounded-full border border-[#1A1A1E] bg-[#0A0A0C] flex items-center justify-center">
              <svg className="w-5 h-5 text-[#333]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-xs font-bold text-[#E5E5E5] uppercase tracking-wider">NO STRATEGY ACTIVE</h3>
              <p className="text-[10px] text-[#444] mt-1">Configure entry and exit rules on the left panel, then run backtest</p>
            </div>
          </div>
        )}

        {result && !isRunning && (
          <div className="flex-1 flex flex-col min-h-0 md:overflow-hidden">
            {/* Report Header Nav Tabs */}
            <div className="border-b border-[#15151A] bg-[#08080A] flex items-center px-4 py-2 justify-between flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`px-3 py-1.5 text-xs font-mono font-bold rounded transition-all border ${
                    activeTab === 'overview'
                      ? 'bg-[#121215] text-terminal-green border-[#25252E] shadow-sm'
                      : 'bg-transparent text-[#949494] border-transparent hover:text-[#888]'
                  }`}
                >
                  Overview & Performance
                </button>
                <button
                  onClick={() => setActiveTab('trades')}
                  className={`px-3 py-1.5 text-xs font-mono font-bold rounded transition-all border ${
                    activeTab === 'trades'
                      ? 'bg-[#121215] text-terminal-green border-[#25252E] shadow-sm'
                      : 'bg-transparent text-[#949494] border-transparent hover:text-[#888]'
                  }`}
                >
                  Trade Log
                </button>
              </div>
              
              <div className="text-[10px] font-mono text-[#555] uppercase">
                {result.ticker} &bull; {timeframe} timeframe &bull; {result.trades.length} trades
              </div>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 md:overflow-y-auto md:h-full terminal-scrollbar">
              {activeTab === 'overview' && (
                <div className="space-y-4 pb-4">
                  {/* Performance stats summary */}
                  <BacktestMetricsGrid result={result} />
                  
                  {/* Interactive charts */}
                  <BacktestCharts result={result} />
                </div>
              )}

              {activeTab === 'trades' && (
                <div className="pb-4">
                  <BacktestTradeLog trades={result.trades} />
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
