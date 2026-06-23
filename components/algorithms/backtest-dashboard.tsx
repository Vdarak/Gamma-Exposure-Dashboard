"use client"

import React, { useState, useEffect } from 'react';
import { BacktestConfig, BacktestResult, IndicatorConfig, IndicatorCondition } from '../../backend/src/backtester/types';
import { BacktestConfigForm } from './backtest-config-form';
import { BacktestMetricsGrid } from './backtest-metrics-grid';
import { BacktestCharts } from './backtest-charts';
import { BacktestTradeLog } from './backtest-trade-log';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Maximize2, MessageSquare, Send, Sparkles, ChevronDown, ChevronUp, Sliders, Settings, X, Play, ChevronLeft, ChevronRight } from 'lucide-react';

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
  const [tickerDateRange, setTickerDateRange] = useState<{ minDate: string; maxDate: string } | null>(null);
  
  // 0DTE Options Suggestion Backtester state
  const [assetClass, setAssetClass] = useState<'equity' | 'option'>('equity');
  const [optionsStrategyClass, setOptionsStrategyClass] = useState<string>('multileg');
  const [optionStopLoss, setOptionStopLoss] = useState<number>(50);
  const [optionTakeProfit, setOptionTakeProfit] = useState<number>(50);

  // Form states
  const [ticker, setTicker] = useState('SPY');
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-12-31');
  const [initialCapital, setInitialCapital] = useState(10000);
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | '30m' | '1h' | '1d'>('1d');
  const [commission, setCommission] = useState(0.50);
  const [slippagePercent, setSlippagePercent] = useState(0.05);
  const [strategyType, setStrategyType] = useState<'long' | 'short' | 'both'>('both');
  const [leftSidebarTab, setLeftSidebarTab] = useState<'settings' | 'chat'>('settings');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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

  const runSimulation = async (configToRun: any) => {
    setIsRunning(true);
    setError(null);

    try {
      const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
      let response;

      if (assetClass === 'option') {
        const isMultiLeg = optionsStrategyClass === 'multileg';
        const url = isMultiLeg 
          ? `${BACKEND_URL}/api/backtest/options/multileg`
          : `${BACKEND_URL}/api/backtest/options/single-leg`;
          
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ticker: ticker,
            startDate: startDate,
            endDate: endDate,
            initialCapital: initialCapital,
            strategyClass: optionsStrategyClass,
            takeProfitPercent: optionTakeProfit,
            stopLossPercent: optionStopLoss
          }),
        });
      } else {
        response = await fetch(`${BACKEND_URL}/api/backtest/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(configToRun),
        });
      }

      const json = await response.json();
      if (response.ok && json.success) {
        setResult(json.data);
        localStorage.setItem('last_backtest_result', JSON.stringify(json.data));
        setActiveTab('overview');
        setLeftSidebarTab('settings'); // Make the settings panel take over the chat
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

  const handleRunBacktest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (assetClass === 'option') {
      await runSimulation({});
    } else {
      const config: BacktestConfig = {
        ticker,
        assetClass: 'equity',
        startDate,
        endDate,
        initialCapital,
        timeframe,
        commission,
        slippagePercent,
        strategyType,
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
      await runSimulation(config);
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
        
        // Extract indicators, rules, risk parameters from parsed response
        const parsedIndicators = Array.isArray(data.indicators) ? data.indicators : [];
        const parsedEntryRules = data.entryRules && Array.isArray(data.entryRules.indicators) ? data.entryRules.indicators : [];
        const parsedExitRules = data.exitRules && Array.isArray(data.exitRules.indicators) ? data.exitRules.indicators : [];
        const parsedSL = data.exitRules?.stopLossPercent != null ? Number(data.exitRules.stopLossPercent) : undefined;
        const parsedTS = data.exitRules?.trailingStopPercent != null ? Number(data.exitRules.trailingStopPercent) : undefined;
        const parsedTP = data.exitRules?.takeProfitPercent != null ? Number(data.exitRules.takeProfitPercent) : undefined;
        const parsedTime = data.exitRules?.timeBasedExitDays != null ? Number(data.exitRules.timeBasedExitDays) : undefined;

        // Update form states based on parsed response
        setIndicators(parsedIndicators);
        setEntryRules(parsedEntryRules);
        setExitRules(parsedExitRules);
        setStopLossPercent(parsedSL);
        setTrailingStopPercent(parsedTS);
        setTakeProfitPercent(parsedTP);
        setTimeBasedExitDays(parsedTime);

        // Generate a nice summary of what was parsed
        let summary = "";
        
        if (parsedIndicators.length > 0) {
          summary += "**Parsed Indicators:**\n";
          parsedIndicators.forEach((ind: any) => {
            summary += `- ${ind.type.toUpperCase()} (Period: ${ind.period1}${ind.period2 ? `, Slow: ${ind.period2}` : ''}${ind.signalPeriod ? `, Sig: ${ind.signalPeriod}` : ''}${ind.stdDev ? `, Dev: ${ind.stdDev}` : ''})\n`;
          });
          summary += "\n";
        }

        if (parsedEntryRules.length > 0) {
          summary += "**Entry Conditions:**\n";
          parsedEntryRules.forEach((rule: any) => {
            summary += `- Buy when **${rule.indicator1}** ${rule.operator.replace('_', ' ')} **${rule.indicator2}**\n`;
          });
          summary += "\n";
        }

        const exits: string[] = [];
        if (parsedExitRules.length > 0) {
          parsedExitRules.forEach((rule: any) => {
            exits.push(`Technical exit when **${rule.indicator1}** ${rule.operator.replace('_', ' ')} **${rule.indicator2}**`);
          });
        }
        if (parsedSL != null) exits.push(`Stop Loss: ${parsedSL}%`);
        if (parsedTP != null) exits.push(`Take Profit: ${parsedTP}%`);
        if (parsedTS != null) exits.push(`Trailing Stop: ${parsedTS}%`);
        if (parsedTime != null) exits.push(`Time exit after ${parsedTime} bars`);

        if (exits.length > 0) {
          summary += "**Exit Conditions:**\n";
          exits.forEach(exit => {
            summary += `- ${exit}\n`;
          });
          summary += "\n";
        }

        if (data.shouldExecute) {
          summary += "⚡ **Execution trigger detected:** Starting simulation...";
          setChatMessages(prev => [...prev, { role: 'assistant', content: summary }]);
          toast.success('Strategy configured & backtest execution started!');
          
          const configToRun: BacktestConfig = {
            ticker,
            assetClass: 'equity',
            startDate,
            endDate,
            initialCapital,
            timeframe,
            commission,
            slippagePercent,
            strategyType,
            indicators: parsedIndicators,
            entryRules: { indicators: parsedEntryRules },
            exitRules: {
              stopLossPercent: parsedSL,
              trailingStopPercent: parsedTS,
              takeProfitPercent: parsedTP,
              timeBasedExitDays: parsedTime,
              indicators: parsedExitRules
            }
          };
          await runSimulation(configToRun);
        } else {
          summary += "You can review and edit these parameters manually in the **Settings** panel. Click the **Play** button to execute.";
          setChatMessages(prev => [...prev, { role: 'assistant', content: summary }]);
          toast.success('Strategy configured successfully!');
        }
      } else {
        throw new Error(json.error || 'Failed to parse strategy');
      }
    } catch (err: any) {
      console.error(err);
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Sorry, I encountered an error while parsing that strategy:\n\n*${err.message || 'Unknown error'}*\n\nPlease try describing it in a different format or configure it manually using the Settings panel.`
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
        <div className="flex flex-col lg:flex-row h-full w-full min-h-0">
          {result ? (
            /* ─── DUAL PANEL SPLIT (After Execution) ─── */
            <div className="flex flex-col lg:flex-row h-full w-full min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-[#15151A]">
              
              {/* Left Panel: Sidebar (40% width) */}
              {!isSidebarCollapsed && (
                <div className="w-full lg:w-[40%] h-full bg-[#08080A] p-4 flex flex-col min-h-0">
                  {/* Sidebar Tabs Header */}
                  <div className="flex items-center justify-between border-b border-[#15151A] pb-2 mb-4 flex-shrink-0">
                    <div className="flex bg-[#111] border border-[#222] rounded p-0.5">
                      <button
                        type="button"
                        onClick={() => setLeftSidebarTab('settings')}
                        className={`px-3 py-1 text-[10px] font-mono font-bold rounded uppercase transition-all flex items-center gap-1.5 ${
                          leftSidebarTab === 'settings' ? 'bg-terminal-green text-black' : 'text-[#888] hover:text-[#FFF]'
                        }`}
                      >
                        <Settings className="w-3 h-3" /> Settings
                      </button>
                      <button
                        type="button"
                        onClick={() => setLeftSidebarTab('chat')}
                        className={`px-3 py-1 text-[10px] font-mono font-bold rounded uppercase transition-all flex items-center gap-1.5 ${
                          leftSidebarTab === 'chat' ? 'bg-terminal-green text-black' : 'text-[#888] hover:text-[#FFF]'
                        }`}
                      >
                        <MessageSquare className="w-3 h-3" /> AI Chat
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 font-mono text-[9px] text-[#666]">
                        <span className="w-2 h-2 rounded-full bg-terminal-green animate-pulse" />
                        <span className="font-bold text-[#E5E5E5]">{ticker} &bull; {timeframe}</span>
                      </div>
                      
                      <button
                        type="button"
                        onClick={() => setIsSidebarCollapsed(true)}
                        className="p-1 hover:bg-[#1A1A1E] text-gray-400 hover:text-white rounded border border-[#222] transition-colors"
                        title="Collapse Sidebar"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>


                {/* Sidebar Tab Content */}
                <div className="flex-1 min-h-0 overflow-y-auto terminal-scrollbar mb-4 flex flex-col gap-3">
                  {leftSidebarTab === 'settings' ? (
                    <>
                      {/* Segment Controller (Asset Switcher) */}
                      <div className="flex bg-[#121215] border border-[#25252E] rounded p-0.5 w-full flex-shrink-0 font-mono text-[9px] uppercase font-bold select-none">
                        <button
                          type="button"
                          onClick={() => setAssetClass('equity')}
                          className={`flex-1 py-1.5 rounded transition-all ${assetClass === 'equity' ? 'bg-terminal-green text-black font-bold' : 'text-[#888] hover:text-white'}`}
                        >
                          Equity (OHLCV Bars)
                        </button>
                        <button
                          type="button"
                          onClick={() => setAssetClass('option')}
                          className={`flex-1 py-1.5 rounded transition-all ${assetClass === 'option' ? 'bg-terminal-green text-black font-bold' : 'text-[#888] hover:text-white'}`}
                        >
                          0DTE Options Engine
                        </button>
                      </div>

                      {assetClass === 'equity' ? (
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
                          strategyType={strategyType}
                          setStrategyType={setStrategyType}
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
                      ) : (
                        <form onSubmit={handleRunBacktest} className="bg-[#08080A] border border-[#15151A] rounded-lg p-4 font-mono text-[#949494] text-xs space-y-4">
                          <h4 className="text-[10px] font-bold text-terminal-green uppercase border-b border-[#1A1A1E] pb-1">0DTE OPTIONS BACKTESTER</h4>
                          
                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] text-[#555] uppercase">Ticker</label>
                              <Select value={ticker} onValueChange={setTicker}>
                                <SelectTrigger className="h-7 bg-black border-[#222] text-[#E5E5E5] text-xs">
                                  <SelectValue placeholder="TICKER" />
                                </SelectTrigger>
                                <SelectContent className="bg-black border-[#222]">
                                  <SelectItem value="SPX" className="text-xs">SPX (S&P 500)</SelectItem>
                                  <SelectItem value="GLD" className="text-xs">GLD (Gold Trust)</SelectItem>
                                  <SelectItem value="TSLA" className="text-xs">TSLA (Tesla)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] text-[#555] uppercase">Capital ($)</label>
                              <input
                                type="number"
                                value={initialCapital}
                                onChange={(e) => setInitialCapital(parseInt(e.target.value) || 10000)}
                                className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] text-[#555] uppercase">Start Date</label>
                              <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono w-full"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] text-[#555] uppercase">End Date</label>
                              <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono w-full"
                              />
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] text-[#555] uppercase">Strategy / Options Contract Candidate</label>
                            <Select value={optionsStrategyClass} onValueChange={setOptionsStrategyClass}>
                              <SelectTrigger className="h-7 bg-black border-[#222] text-[#E5E5E5] text-xs">
                                <SelectValue placeholder="Select strategy" />
                              </SelectTrigger>
                              <SelectContent className="bg-black border-[#222]">
                                <SelectItem value="multileg" className="text-xs">Recommended Spreads (Multi-leg)</SelectItem>
                                <SelectItem value="atm_call" className="text-xs">ATM Long Call Candidate</SelectItem>
                                <SelectItem value="atm_put" className="text-xs">ATM Long Put Candidate</SelectItem>
                                <SelectItem value="otm_25d_call" className="text-xs">OTM 25-Delta Call Candidate</SelectItem>
                                <SelectItem value="otm_25d_put" className="text-xs">OTM 25-Delta Put Candidate</SelectItem>
                                <SelectItem value="otm_15d_call" className="text-xs">OTM 15-Delta Call Candidate</SelectItem>
                                <SelectItem value="otm_15d_put" className="text-xs">OTM 15-Delta Put Candidate</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] text-[#555] uppercase font-bold">Take Profit (%)</label>
                              <input
                                type="number"
                                value={optionTakeProfit}
                                onChange={(e) => setOptionTakeProfit(parseInt(e.target.value) || 50)}
                                className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] text-[#555] uppercase font-bold">Stop Loss (%)</label>
                              <input
                                type="number"
                                value={optionStopLoss}
                                onChange={(e) => setOptionStopLoss(parseInt(e.target.value) || 50)}
                                className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono"
                              />
                            </div>
                          </div>

                          <button
                            type="submit"
                            disabled={isRunning}
                            className="w-full mt-2 py-2 bg-terminal-green hover:bg-[#10B981] text-black hover:text-black font-bold uppercase rounded border border-transparent hover:border-terminal-green flex items-center justify-center gap-1.5 transition-all text-xs"
                          >
                            <Play className="w-3.5 h-3.5 fill-black" /> Run 0DTE Options Backtest
                          </button>
                        </form>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col h-full border border-[#15151A] bg-[#08080A] rounded overflow-hidden">
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
                    </div>
                  )}
                </div>

                {/* Sidebar Input Controls Bar */}
                <div className="flex-shrink-0 bg-[#0A0A0C] border border-[#15151A] p-3 rounded-lg space-y-3 font-mono">
                  <form onSubmit={handleSendChatMessage} className="flex gap-2 border border-[#222] focus-within:border-terminal-green/30 bg-black rounded p-1.5 relative items-center">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Tweak strategy (e.g. Set stop loss to 3%)..."
                      className="flex-1 bg-transparent outline-none text-[#E5E5E5] text-xs px-2 py-1"
                      disabled={isChatLoading}
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="submit"
                        disabled={isChatLoading || !chatInput.trim()}
                        className="h-7 w-7 bg-[#111] hover:bg-[#1A1A24] border border-[#222] text-[#888] hover:text-terminal-green disabled:opacity-40 rounded flex items-center justify-center transition-all"
                        title="Send description to AI"
                      >
                        {isChatLoading ? (
                          <div className="w-3.5 h-3.5 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRunBacktest()}
                        disabled={isRunning}
                        className="h-7 w-7 bg-terminal-green/10 hover:bg-[#10B981]/25 border border-terminal-green/30 hover:border-terminal-green text-terminal-green disabled:opacity-40 rounded flex items-center justify-center transition-all"
                        title="Execute simulation"
                      >
                        <Play className="w-3 h-3 fill-terminal-green" />
                      </button>
                    </div>
                  </form>

                  {/* Sidebar Quick Settings summary Row */}
                  <div className="flex flex-wrap items-center gap-2 text-[9px] text-[#555]">
                    <div className="flex items-center gap-1 bg-[#111] px-2 py-0.5 rounded border border-[#222]">
                      <span>SYM:</span>
                      <span className="text-[#E5E5E5] font-bold">{ticker}</span>
                    </div>
                    <div className="flex items-center gap-1 bg-[#111] px-2 py-0.5 rounded border border-[#222]">
                      <span>TF:</span>
                      <span className="text-[#E5E5E5] font-bold uppercase">{timeframe}</span>
                    </div>
                    <div className="flex items-center gap-1 bg-[#111] px-2 py-0.5 rounded border border-[#222]">
                      <span>CAP:</span>
                      <span className="text-[#E5E5E5] font-bold">${initialCapital}</span>
                    </div>
                    <div className="flex items-center gap-1 bg-[#111] px-2 py-0.5 rounded border border-[#222]">
                      <span>DIR:</span>
                      <span className="text-[#E5E5E5] font-bold uppercase">{strategyType === 'both' ? 'Both' : strategyType === 'long' ? 'Long' : 'Short'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

              {/* Right Panel: Results (60% width or 100% if collapsed) */}
              <div className={`w-full ${isSidebarCollapsed ? 'lg:w-full' : 'lg:w-[60%]'} flex flex-col h-full bg-[#020203] min-h-0 overflow-y-auto lg:overflow-hidden`}>
                {/* Results Header */}
                <div className="border-b border-[#15151A] bg-[#08080A] flex items-center px-4 py-2 justify-between flex-shrink-0 font-mono">
                  <div className="flex items-center gap-1.5">
                    {isSidebarCollapsed && (
                      <button
                        type="button"
                        onClick={() => setIsSidebarCollapsed(false)}
                        className="px-2.5 py-1 bg-[#111] hover:bg-[#1A1A24] text-[#E5E5E5] border border-[#222] hover:border-terminal-green rounded text-[10px] font-bold font-mono transition-all uppercase tracking-wider flex items-center gap-1.5 mr-2"
                        title="Expand Sidebar"
                      >
                        <ChevronRight className="w-3.5 h-3.5 text-terminal-green" /> Sidebar
                      </button>
                    )}
                    <button
                      onClick={() => setActiveTab('overview')}
                      className={`px-3 py-1.5 text-xs font-bold rounded transition-all border ${
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
                      Trade Log
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleRunBacktest()}
                      disabled={isRunning}
                      className="px-2.5 py-1 bg-terminal-green/10 hover:bg-[#10B981]/25 text-terminal-green border border-terminal-green/30 hover:border-terminal-green disabled:opacity-40 rounded text-[10px] font-bold transition-all uppercase tracking-wider flex items-center gap-1"
                      title="Re-run Simulation"
                    >
                      <Play className="w-2.5 h-2.5 fill-terminal-green" /> Run
                    </button>

                    <button
                      onClick={() => {
                        setResult(null);
                        setIsSidebarCollapsed(false);
                      }}
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
                      <BacktestMetricsGrid result={result} />
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
            </div>
          ) : (
            /* ─── INITIAL CHATGPT-STYLE BUILDER VIEW (Before Execution) ─── */
            <div className="max-w-2xl mx-auto w-full py-12 px-4 flex flex-col min-h-0 h-full font-mono">
              <div className="text-center mb-8 flex-shrink-0">
                <h2 className="text-sm font-bold text-terminal-green uppercase tracking-wider flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4 text-terminal-green animate-pulse" /> STRATEGY STUDIO AI
                </h2>
                <p className="text-[10px] text-[#555] mt-1.5">Conversational AI-driven backtesting platform</p>
              </div>

              {/* Chat view area */}
              <div className="flex-1 min-h-[250px] border border-[#15151A] bg-[#08080A]/60 rounded-lg p-4 mb-4 overflow-y-auto terminal-scrollbar flex flex-col justify-end">
                <div className="space-y-4">
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[90%] rounded-lg p-3 border ${
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
                        <div className="space-y-1 text-xs">
                          {formatMessageContent(msg.content)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Input Form Area */}
              <div className="space-y-3 bg-[#0A0A0C] border border-[#15151A] p-4 rounded-lg flex-shrink-0">
                <form onSubmit={handleSendChatMessage} className="flex gap-2 border border-[#222] focus-within:border-terminal-green/30 bg-black rounded p-2 relative items-center">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Describe strategy (e.g. Buy when RSI < 30 and Close > EMA 50. Run backtest)..."
                    className="flex-1 bg-transparent outline-none text-[#E5E5E5] text-xs px-2 py-1.5"
                    disabled={isChatLoading}
                  />
                  <div className="flex items-center gap-1.5 pr-1">
                    <button
                      type="submit"
                      disabled={isChatLoading || !chatInput.trim()}
                      className="h-8 w-8 bg-[#111] hover:bg-[#1A1A24] border border-[#222] text-[#888] hover:text-terminal-green disabled:opacity-40 rounded flex items-center justify-center transition-all"
                      title="Send description to AI"
                    >
                      {isChatLoading ? (
                        <div className="w-4 h-4 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunBacktest()}
                      disabled={isRunning}
                      className="h-8 w-8 bg-terminal-green/10 hover:bg-[#10B981]/25 border border-terminal-green/30 hover:border-terminal-green text-terminal-green disabled:opacity-40 rounded flex items-center justify-center transition-all"
                      title="Execute simulation"
                    >
                      <Play className="w-3.5 h-3.5 fill-terminal-green" />
                    </button>
                  </div>
                </form>

                {/* Quick adjustments row */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] text-[#666] pt-1">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[8px] uppercase text-[#444] font-bold">Ticker</label>
                      <select 
                        value={ticker} 
                        onChange={(e) => setTicker(e.target.value)} 
                        className="bg-black border border-[#222] text-[#E5E5E5] text-[10px] px-2 py-0.5 rounded outline-none h-6 focus:border-terminal-green/30 font-mono"
                      >
                        {availableTickers.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label className="text-[8px] uppercase text-[#444] font-bold">Timeframe</label>
                      <select 
                        value={timeframe} 
                        onChange={(e) => setTimeframe(e.target.value as any)} 
                        className="bg-black border border-[#222] text-[#E5E5E5] text-[10px] px-2 py-0.5 rounded outline-none h-6 focus:border-terminal-green/30 font-mono"
                      >
                        <option value="1d">Daily (1d)</option>
                        <option value="1h">1 Hour (1h)</option>
                        <option value="30m">30 Min (30m)</option>
                        <option value="15m">15 Min (15m)</option>
                        <option value="5m">5 Min (5m)</option>
                        <option value="1m">1 Min (1m)</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label className="text-[8px] uppercase text-[#444] font-bold">Cap ($)</label>
                      <input 
                        type="number"
                        value={initialCapital}
                        onChange={(e) => setInitialCapital(parseInt(e.target.value) || 10000)}
                        className="bg-black border border-[#222] text-[#E5E5E5] text-[10px] px-2 py-0.5 rounded outline-none h-6 w-20 focus:border-terminal-green/30 font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-auto">
                    <button
                      type="button"
                      onClick={() => setIsCustomSettingsOpen(!isCustomSettingsOpen)}
                      className={`h-6 px-2.5 rounded border text-[9px] font-bold flex items-center gap-1 transition-all ${
                        isCustomSettingsOpen 
                          ? 'bg-terminal-green text-black border-terminal-green' 
                          : 'bg-[#111] hover:bg-[#1A1A24] border-[#222] text-[#888] hover:text-[#FFF]'
                      }`}
                    >
                      <Settings className="w-3 h-3" /> Config
                    </button>
                  </div>
                </div>

                {/* Collapsible config form panel */}
                {isCustomSettingsOpen && (
                  <div className="border border-[#15151A] bg-[#08080A]/40 p-4 rounded-lg mt-3 overflow-y-auto max-h-[350px] terminal-scrollbar flex flex-col gap-3">
                    {/* Segment Controller (Asset Switcher) */}
                    <div className="flex bg-[#121215] border border-[#25252E] rounded p-0.5 w-full flex-shrink-0 font-mono text-[9px] uppercase font-bold select-none">
                      <button
                        type="button"
                        onClick={() => setAssetClass('equity')}
                        className={`flex-1 py-1.5 rounded transition-all ${assetClass === 'equity' ? 'bg-terminal-green text-black font-bold' : 'text-[#888] hover:text-white'}`}
                      >
                        Equity (OHLCV Bars)
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssetClass('option')}
                        className={`flex-1 py-1.5 rounded transition-all ${assetClass === 'option' ? 'bg-terminal-green text-black font-bold' : 'text-[#888] hover:text-white'}`}
                      >
                        0DTE Options Engine
                      </button>
                    </div>

                    {assetClass === 'equity' ? (
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
                        strategyType={strategyType}
                        setStrategyType={setStrategyType}
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
                    ) : (
                      <form onSubmit={handleRunBacktest} className="bg-[#08080A] border border-[#15151A] rounded-lg p-4 font-mono text-[#949494] text-xs space-y-4">
                        <h4 className="text-[10px] font-bold text-terminal-green uppercase border-b border-[#1A1A1E] pb-1">0DTE OPTIONS BACKTESTER</h4>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] text-[#555] uppercase">Ticker</label>
                            <Select value={ticker} onValueChange={setTicker}>
                              <SelectTrigger className="h-7 bg-black border-[#222] text-[#E5E5E5] text-xs">
                                <SelectValue placeholder="TICKER" />
                              </SelectTrigger>
                              <SelectContent className="bg-black border-[#222]">
                                <SelectItem value="SPX" className="text-xs">SPX (S&P 500)</SelectItem>
                                <SelectItem value="GLD" className="text-xs">GLD (Gold Trust)</SelectItem>
                                <SelectItem value="TSLA" className="text-xs">TSLA (Tesla)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] text-[#555] uppercase">Capital ($)</label>
                            <input
                              type="number"
                              value={initialCapital}
                              onChange={(e) => setInitialCapital(parseInt(e.target.value) || 10000)}
                              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] text-[#555] uppercase">Start Date</label>
                            <input
                              type="date"
                              value={startDate}
                              onChange={(e) => setStartDate(e.target.value)}
                              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono w-full"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] text-[#555] uppercase">End Date</label>
                            <input
                              type="date"
                              value={endDate}
                              onChange={(e) => setEndDate(e.target.value)}
                              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono w-full"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] text-[#555] uppercase">Strategy / Options Contract Candidate</label>
                          <Select value={optionsStrategyClass} onValueChange={setOptionsStrategyClass}>
                            <SelectTrigger className="h-7 bg-black border-[#222] text-[#E5E5E5] text-xs">
                              <SelectValue placeholder="Select strategy" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-[#222]">
                              <SelectItem value="multileg" className="text-xs">Recommended Spreads (Multi-leg)</SelectItem>
                              <SelectItem value="atm_call" className="text-xs">ATM Long Call Candidate</SelectItem>
                              <SelectItem value="atm_put" className="text-xs">ATM Long Put Candidate</SelectItem>
                              <SelectItem value="otm_25d_call" className="text-xs">OTM 25-Delta Call Candidate</SelectItem>
                              <SelectItem value="otm_25d_put" className="text-xs">OTM 25-Delta Put Candidate</SelectItem>
                              <SelectItem value="otm_15d_call" className="text-xs">OTM 15-Delta Call Candidate</SelectItem>
                              <SelectItem value="otm_15d_put" className="text-xs">OTM 15-Delta Put Candidate</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] text-[#555] uppercase font-bold">Take Profit (%)</label>
                            <input
                              type="number"
                              value={optionTakeProfit}
                              onChange={(e) => setOptionTakeProfit(parseInt(e.target.value) || 50)}
                              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] text-[#555] uppercase font-bold">Stop Loss (%)</label>
                            <input
                              type="number"
                              value={optionStopLoss}
                              onChange={(e) => setOptionStopLoss(parseInt(e.target.value) || 50)}
                              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={isRunning}
                          className="w-full mt-2 py-2 bg-terminal-green hover:bg-[#10B981] text-black hover:text-black font-bold uppercase rounded border border-transparent hover:border-terminal-green flex items-center justify-center gap-1.5 transition-all text-xs"
                        >
                          <Play className="w-3.5 h-3.5 fill-black" /> Run 0DTE Options Backtest
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
