"use client"

import React, { useState, useEffect } from 'react';
import { BacktestConfig, BacktestResult, IndicatorConfig, IndicatorCondition } from '../../backend/src/backtester/types';
import { BacktestConfigForm } from './backtest-config-form';
import { BacktestMetricsGrid } from './backtest-metrics-grid';
import { BacktestCharts } from './backtest-charts';
import { BacktestTradeLog } from './backtest-trade-log';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';
import { Maximize2, MessageSquare, Send, Sparkles, ChevronDown, ChevronUp, Sliders, Settings, X } from 'lucide-react';
import { StrategyTerminalDrawer } from './strategy-terminal-drawer';

// Helper to format bold and lists in chat messages
const formatMessageContent = (text: string) => {
  const paragraphs = text.split('\n');
  return paragraphs.map((para, i) => {
    if (!para.trim()) return <div key={i} className="h-2" />;
    
    // Check if it's a list item
    const isListItem = para.trim().startsWith('- ') || para.trim().startsWith('* ');
    let cleanText = para;
    if (isListItem) {
      cleanText = para.trim().replace(/^[-*]\s+/, '');
    }
    
    // Parse bold text **bold**
    const parts = cleanText.split(/(\*\*.*?\*\*)/g);
    const content = parts.map((part, partIdx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={partIdx} className="text-terminal-green font-bold">{part.slice(2, -2)}</strong>;
      }
      return part;
    });

    if (isListItem) {
      return (
        <li key={i} className="ml-4 list-disc text-[#949494] text-[11px] leading-relaxed">
          {content}
        </li>
      );
    }
    return (
      <p key={i} className="text-[#949494] text-[11px] leading-relaxed">
        {content}
      </p>
    );
  });
};

export function BacktestDashboard() {
  const [availableTickers, setAvailableTickers] = useState<string[]>([]);
  const [isLoadingTickers, setIsLoadingTickers] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [isStrategyTerminalOpen, setIsStrategyTerminalOpen] = useState(false);
  const [tickerDateRange, setTickerDateRange] = useState<{ minDate: string; maxDate: string } | null>(null);

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

  // AI Chat States
  const [isCustomSettingsOpen, setIsCustomSettingsOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    {
      role: 'assistant',
      content: "Welcome to Strategy Studio AI! 🤖\n\nDescribe your trading strategy in plain English, and I will automatically parse it to configure the technical indicators and trigger rules below.\n\n**Example Prompt:**\n*\"Buy when RSI 14 is below 30 and Close is above EMA 50. Exit when price crosses below SMA 20, or after 5 days. Set a 2% stop loss and 5% take profit.\"*"
    }
  ]);

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

  // Fetch date range whenever ticker changes
  useEffect(() => {
    async function fetchDateRange() {
      if (!ticker) return;
      try {
        const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
        const response = await fetch(`${BACKEND_URL}/api/backtest/ticker-info?ticker=${ticker}`);
        if (response.ok) {
          const json = await response.json();
          if (json.success && json.data) {
            const { minDate, maxDate } = json.data;
            setTickerDateRange({ minDate, maxDate });
            
            // Default: set to maxDate and maxDate - 1 year (clamped to minDate)
            const maxVal = new Date(maxDate);
            const defaultStart = new Date(maxVal);
            defaultStart.setFullYear(defaultStart.getFullYear() - 1);
            
            const minVal = new Date(minDate);
            const finalStart = defaultStart < minVal ? minDate : defaultStart.toISOString().split('T')[0];
            
            setStartDate(finalStart);
            setEndDate(maxDate);
          }
        }
      } catch (err) {
        console.error(`Error loading date range for ${ticker}:`, err);
      }
    }
    fetchDateRange();
  }, [ticker]);

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

  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userDesc = chatInput;
    setChatInput('');
    
    // Add user message to chat
    setChatMessages(prev => [...prev, { role: 'user', content: userDesc }]);
    setIsChatLoading(true);

    try {
      const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
      const response = await fetch(`${BACKEND_URL}/api/backtest/parse-strategy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description: userDesc }),
      });

      if (!response.ok) {
        throw new Error('Failed to parse strategy via AI engine');
      }

      const json = await response.json();
      if (json.success && json.data) {
        const data = json.data;
        
        // Update form states based on parsed response
        if (Array.isArray(data.indicators)) {
          setIndicators(data.indicators);
        }
        if (data.entryRules && Array.isArray(data.entryRules.indicators)) {
          setEntryRules(data.entryRules.indicators);
        }
        if (data.exitRules) {
          if (Array.isArray(data.exitRules.indicators)) {
            setExitRules(data.exitRules.indicators);
          }
          
          setStopLossPercent(data.exitRules.stopLossPercent != null ? Number(data.exitRules.stopLossPercent) : undefined);
          setTrailingStopPercent(data.exitRules.trailingStopPercent != null ? Number(data.exitRules.trailingStopPercent) : undefined);
          setTakeProfitPercent(data.exitRules.takeProfitPercent != null ? Number(data.exitRules.takeProfitPercent) : undefined);
          setTimeBasedExitDays(data.exitRules.timeBasedExitDays != null ? Number(data.exitRules.timeBasedExitDays) : undefined);
        }

        // Generate a nice summary of what was parsed
        let summary = "I have successfully parsed and configured your strategy!\n\n";
        
        if (data.indicators && data.indicators.length > 0) {
          summary += "**Parsed Indicators:**\n";
          data.indicators.forEach((ind: any) => {
            summary += `- ${ind.type.toUpperCase()} (Period: ${ind.period1}${ind.period2 ? `, Slow: ${ind.period2}` : ''}${ind.signalPeriod ? `, Sig: ${ind.signalPeriod}` : ''}${ind.stdDev ? `, Dev: ${ind.stdDev}` : ''})\n`;
          });
          summary += "\n";
        }

        if (data.entryRules && data.entryRules.indicators && data.entryRules.indicators.length > 0) {
          summary += "**Entry Conditions:**\n";
          data.entryRules.indicators.forEach((rule: any) => {
            summary += `- Buy when **${rule.indicator1}** ${rule.operator.replace('_', ' ')} **${rule.indicator2}**\n`;
          });
          summary += "\n";
        }

        const exits: string[] = [];
        if (data.exitRules) {
          if (data.exitRules.indicators && data.exitRules.indicators.length > 0) {
            data.exitRules.indicators.forEach((rule: any) => {
              exits.push(`Technical exit when **${rule.indicator1}** ${rule.operator.replace('_', ' ')} **${rule.indicator2}**`);
            });
          }
          if (data.exitRules.stopLossPercent != null) {
            exits.push(`Stop Loss: ${data.exitRules.stopLossPercent}%`);
          }
          if (data.exitRules.takeProfitPercent != null) {
            exits.push(`Take Profit: ${data.exitRules.takeProfitPercent}%`);
          }
          if (data.exitRules.trailingStopPercent != null) {
            exits.push(`Trailing Stop: ${data.exitRules.trailingStopPercent}%`);
          }
          if (data.exitRules.timeBasedExitDays != null) {
            exits.push(`Time exit after ${data.exitRules.timeBasedExitDays} bars`);
          }
        }

        if (exits.length > 0) {
          summary += "**Exit Conditions:**\n";
          exits.forEach(exit => {
            summary += `- ${exit}\n`;
          });
          summary += "\n";
        }

        summary += "You can review and edit these parameters manually by expanding the **Custom Settings** panel. Click **Execute Strategy Backtest** when you are ready.";

        setChatMessages(prev => [...prev, { role: 'assistant', content: summary }]);
        toast.success('Strategy configured successfully!');
      } else {
        throw new Error(json.error || 'Failed to parse strategy');
      }
    } catch (err: any) {
      console.error(err);
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Sorry, I encountered an error while parsing that strategy:\n\n*${err.message || 'Unknown error'}*\n\nPlease try describing it in a different format or configure it manually using the Custom Settings panel.`
      }]);
      toast.error('AI Strategy parsing failed');
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#020203] overflow-y-auto lg:overflow-hidden select-none relative">
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
            <button 
              onClick={() => setError(null)}
              className="mt-2 text-xs text-terminal-green hover:underline self-start font-bold uppercase"
            >
              Back to Studio
            </button>
          </div>
        </div>
      )}

      {!error && (
        <div className={`flex flex-col lg:flex-row h-full w-full min-h-0 ${result ? 'divide-y lg:divide-y-0 lg:divide-x divide-[#15151A]' : ''}`}>
          
          {/* ─── LEFT PANEL: CHAT & COLLAPSIBLE CONFIG ─── */}
          <div className={`${result ? 'w-full lg:w-[40%] h-full bg-[#08080A] p-4' : 'max-w-4xl mx-auto w-full py-6 px-4'} flex flex-col min-h-0 overflow-y-auto terminal-scrollbar`}>
            
            {/* Header */}
            <div className="border border-[#15151A] bg-[#08080A] p-4 rounded flex justify-between items-center flex-shrink-0 mb-4 font-mono">
              <div>
                <h3 className="text-xs font-bold text-terminal-green uppercase tracking-wider">STRATEGY STUDIO AI</h3>
                <p className="text-[10px] text-[#555] mt-1">Conversational AI-driven backtesting platform</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-terminal-green animate-pulse" />
                <span className="text-[10px] text-terminal-green font-bold uppercase tracking-widest hidden sm:inline">AI ASSISTANT ACTIVE</span>
                <button
                  type="button"
                  onClick={() => setIsStrategyTerminalOpen(true)}
                  className="p-1.5 hover:bg-[#1C202E]/60 border border-transparent hover:border-[#2B3045]/60 text-gray-400 hover:text-white rounded transition-colors"
                  title="Expand Strategy Workspace"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Chat Interface Container */}
            <div className={`flex flex-col border border-[#15151A] bg-[#08080A] rounded mb-4 flex-shrink-0 transition-all duration-300 ${
              isCustomSettingsOpen ? 'h-[220px]' : 'flex-1 min-h-[300px]'
            }`}>
              {/* Chat Message List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs terminal-scrollbar">
                {chatMessages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded p-3 border ${
                      msg.role === 'user' 
                        ? 'bg-[#121815] border-terminal-green/20 text-[#E5E5E5]' 
                        : 'bg-[#0E0E12] border-[#222] text-[#949494]'
                    }`}>
                      <div className="flex items-center gap-1.5 mb-1.5 border-b border-[#222]/40 pb-1 text-[9px] font-bold">
                        {msg.role === 'user' ? (
                          <span className="text-terminal-green uppercase">USER REQUEST</span>
                        ) : (
                          <span className="text-terminal-green uppercase flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-terminal-green" /> STRATEGY BOT
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {formatMessageContent(msg.content)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Chat Input Bar */}
              <form onSubmit={handleSendChatMessage} className="border-t border-[#15151A] bg-[#0C0C0F] p-3 flex gap-2 flex-shrink-0">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Describe a trading strategy in plain English..."
                  className="flex-1 bg-black border border-[#222] focus:border-terminal-green/30 outline-none text-[#E5E5E5] text-xs font-mono px-3 py-1.5 rounded"
                  disabled={isChatLoading}
                />
                <button
                  type="submit"
                  disabled={isChatLoading || !chatInput.trim()}
                  className="h-8 w-16 bg-terminal-green/10 hover:bg-terminal-green/20 border border-terminal-green/30 hover:border-terminal-green text-terminal-green disabled:opacity-40 rounded flex items-center justify-center transition-all"
                >
                  {isChatLoading ? (
                    <div className="w-4 h-4 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </button>
              </form>
            </div>

            {/* Collapsible Settings Toggle */}
            <button
              type="button"
              onClick={() => setIsCustomSettingsOpen(!isCustomSettingsOpen)}
              className="w-full flex items-center justify-between px-4 py-2 border border-[#15151A] bg-[#08080A] hover:bg-[#0E0E12] transition-colors rounded text-left font-mono mb-4 flex-shrink-0"
            >
              <span className="text-[10px] font-bold text-terminal-green uppercase flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" /> ⚡ CUSTOM SETTINGS / MANUALLY EDIT STRATEGY
              </span>
              {isCustomSettingsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {/* Custom Settings Form Container */}
            {isCustomSettingsOpen && (
              <div className="flex-shrink-0 mb-4 transition-all duration-300">
                <BacktestConfigForm
                  availableTickers={availableTickers}
                  isLoadingTickers={isLoadingTickers}
                  ticker={ticker}
                  setTicker={setTicker}
                  tickerDateRange={tickerDateRange}
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
              </div>
            )}

            {/* Execution Block */}
            <div className="border border-[#15151A] bg-[#0A0A0C] p-4 rounded text-center space-y-3 flex-shrink-0 mt-auto">
              <div className="max-w-md mx-auto text-[9px] text-[#555] font-mono leading-relaxed">
                Execute backtest on historical OHLCV data. Slippage and trading commissions are simulated in real-time.
              </div>
              <button
                onClick={handleRunBacktest}
                disabled={isRunning}
                className="px-6 py-2.5 bg-terminal-green/10 hover:bg-[#10B981]/25 text-terminal-green border border-terminal-green/30 hover:border-terminal-green disabled:opacity-40 rounded font-mono font-bold transition-all uppercase tracking-wider text-xs shadow-[0_0_15px_rgba(16,185,129,0.05)] hover:shadow-[0_0_20px_rgba(16,185,129,0.15)] w-full"
              >
                EXECUTE BACKTEST SIMULATION
              </button>
            </div>
          </div>

          {/* ─── RIGHT PANEL: WORKSPACE / REPORT (DUAL PANEL SPLIT) ─── */}
          {result && (
            <div className="w-full lg:w-[60%] flex flex-col h-full bg-[#020203] min-h-0 overflow-y-auto lg:overflow-hidden">
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
                
                <div className="flex items-center gap-3">
                  <div className="text-[10px] font-mono text-[#555] uppercase hidden md:block">
                    {result.ticker} &bull; {timeframe} timeframe &bull; {result.trades.length} trades
                  </div>
                  <button
                    onClick={() => setResult(null)}
                    className="p-1 hover:bg-[#1A1A1E] text-gray-400 hover:text-white rounded border border-[#222] transition-colors"
                    title="Close Simulation Results"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Tab Contents */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 md:h-full lg:overflow-y-auto terminal-scrollbar">
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
        </div>
      )}

      {/* Expanded Strategy Terminal Workspace Drawer */}
      <StrategyTerminalDrawer
        isOpen={isStrategyTerminalOpen}
        onClose={() => setIsStrategyTerminalOpen(false)}
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
    </div>
  );
}
