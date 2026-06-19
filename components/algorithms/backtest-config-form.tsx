"use client"

import React, { useState } from 'react';
import { IndicatorConfig, IndicatorCondition } from '../../backend/src/backtester/types';
import { Plus, Trash2, HelpCircle, Sliders, LineChart, Code } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StrategyConditionBlock } from './strategy-condition-block';
import { toast } from 'sonner';

interface BacktestConfigFormProps {
  availableTickers: string[];
  isLoadingTickers: boolean;
  ticker: string;
  setTicker: (val: string) => void;
  tickerDateRange: { minDate: string; maxDate: string } | null;
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
  initialCapital: number;
  setInitialCapital: (val: number) => void;
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '1d';
  setTimeframe: (val: '1m' | '5m' | '15m' | '30m' | '1h' | '1d') => void;
  commission: number;
  setCommission: (val: number) => void;
  slippagePercent: number;
  setSlippagePercent: (val: number) => void;
  strategyType: 'long' | 'short' | 'both';
  setStrategyType: (val: 'long' | 'short' | 'both') => void;
  indicators: IndicatorConfig[];
  setIndicators: React.Dispatch<React.SetStateAction<IndicatorConfig[]>>;
  entryRules: IndicatorCondition[];
  setEntryRules: React.Dispatch<React.SetStateAction<IndicatorCondition[]>>;
  exitRules: IndicatorCondition[];
  setExitRules: React.Dispatch<React.SetStateAction<IndicatorCondition[]>>;
  
  stopLossPercent: number | undefined;
  setStopLossPercent: (val: number | undefined) => void;
  trailingStopPercent: number | undefined;
  setTrailingStopPercent: (val: number | undefined) => void;
  takeProfitPercent: number | undefined;
  setTakeProfitPercent: (val: number | undefined) => void;
  timeBasedExitDays: number | undefined;
  setTimeBasedExitDays: (val: number | undefined) => void;

  onSubmit: (e: React.FormEvent) => void;
  isRunning: boolean;
}

export function BacktestConfigForm({
  availableTickers,
  isLoadingTickers,
  ticker,
  setTicker,
  tickerDateRange,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  initialCapital,
  setInitialCapital,
  timeframe,
  setTimeframe,
  commission,
  setCommission,
  slippagePercent,
  setSlippagePercent,
  strategyType,
  setStrategyType,
  indicators,
  setIndicators,
  entryRules,
  setEntryRules,
  exitRules,
  setExitRules,
  stopLossPercent,
  setStopLossPercent,
  trailingStopPercent,
  setTrailingStopPercent,
  takeProfitPercent,
  setTakeProfitPercent,
  timeBasedExitDays,
  setTimeBasedExitDays,
  onSubmit,
  isRunning
}: BacktestConfigFormProps) {

  // Local state for tabs and adding indicators
  const [activeTab, setActiveTab] = useState<'global' | 'indicators' | 'triggers'>('global');
  const [newIndType, setNewIndType] = useState<'sma' | 'ema' | 'rsi' | 'macd' | 'bb' | 'atr'>('sma');
  const [newIndPeriod, setNewIndPeriod] = useState(14);

  // Generate list of available indicator keys to reference in rules
  const getIndicatorKeys = () => {
    const keys = ['close', 'open', 'high', 'low'];
    indicators.forEach(ind => {
      if (ind.type === 'sma') keys.push(`sma_${ind.period1}`);
      else if (ind.type === 'ema') keys.push(`ema_${ind.period1}`);
      else if (ind.type === 'rsi') keys.push(`rsi_${ind.period1}`);
      else if (ind.type === 'atr') keys.push(`atr_${ind.period1}`);
      else if (ind.type === 'macd') {
        const slow = ind.period2 || 26;
        const sig = ind.signalPeriod || 9;
        keys.push(`macd_line_${ind.period1}_${slow}_${sig}`);
        keys.push(`macd_signal_${ind.period1}_${slow}_${sig}`);
        keys.push(`macd_hist_${ind.period1}_${slow}_${sig}`);
      } else if (ind.type === 'bb') {
        const dev = ind.stdDev || 2;
        keys.push(`bb_upper_${ind.period1}_${dev}`);
        keys.push(`bb_middle_${ind.period1}_${dev}`);
        keys.push(`bb_lower_${ind.period1}_${dev}`);
      }
    });
    return keys;
  };

  const addIndicator = () => {
    const duplicate = indicators.some(ind => ind.type === newIndType && ind.period1 === newIndPeriod);
    if (duplicate) return;
    
    const newConfig: IndicatorConfig = {
      type: newIndType,
      period1: newIndPeriod
    };
    if (newIndType === 'macd') {
      newConfig.period2 = 26;
      newConfig.signalPeriod = 9;
    } else if (newIndType === 'bb') {
      newConfig.stdDev = 2;
    }

    setIndicators(prev => [...prev, newConfig]);
    toast.success(`Added ${newIndType.toUpperCase()}(${newIndPeriod})`);
  };

  const removeIndicator = (idx: number) => {
    setIndicators(prev => prev.filter((_, i) => i !== idx));
  };

  const addEntryRule = () => {
    setEntryRules(prev => [...prev, { indicator1: 'close', operator: 'greater_than', indicator2: 100 }]);
  };

  const removeEntryRule = (idx: number) => {
    setEntryRules(prev => prev.filter((_, i) => i !== idx));
  };

  const addExitRule = () => {
    setExitRules(prev => [...prev, { indicator1: 'close', operator: 'less_than', indicator2: 100 }]);
  };

  const removeExitRule = (idx: number) => {
    setExitRules(prev => prev.filter((_, i) => i !== idx));
  };

  const applyDatePreset = (years: number) => {
    if (!tickerDateRange) return;
    const { minDate, maxDate } = tickerDateRange;
    
    const maxVal = new Date(maxDate);
    const startVal = new Date(maxVal);
    startVal.setFullYear(startVal.getFullYear() - years);
    
    const minVal = new Date(minDate);
    const finalStart = startVal < minVal ? minDate : startVal.toISOString().split('T')[0];
    
    setStartDate(finalStart);
    setEndDate(maxDate);
    toast.success(`Set date range to ${years} year(s)`);
  };

  const indicatorKeys = getIndicatorKeys();

  return (
    <div className="bg-[#08080A] border border-[#15151A] rounded-lg p-4 font-mono text-[#949494] text-xs">
      
      {/* Tabs Navigation */}
      <div className="flex border-b border-[#1A1A1E] mb-4">
        <button
          type="button"
          onClick={() => setActiveTab('global')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 font-bold transition-all text-[11px] ${
            activeTab === 'global'
              ? 'border-terminal-green text-terminal-green'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          GLOBAL & RISK
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('indicators')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 font-bold transition-all text-[11px] ${
            activeTab === 'indicators'
              ? 'border-terminal-green text-terminal-green'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <LineChart className="w-3.5 h-3.5" />
          INDICATORS ({indicators.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('triggers')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 font-bold transition-all text-[11px] ${
            activeTab === 'triggers'
              ? 'border-terminal-green text-terminal-green'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <Code className="w-3.5 h-3.5" />
          RULES & TRIGGERS
        </button>
      </div>

      {/* Tab 1: Global & Risk Parameters */}
      {activeTab === 'global' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Column 1: Core Parameters */}
          <div className="space-y-4">
            <h4 className="text-[10px] font-bold text-terminal-green uppercase border-b border-[#1A1A1E] pb-1">SIMULATION SETUP</h4>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-[#555] uppercase">Ticker</label>
                {isLoadingTickers ? (
                  <div className="h-7 bg-[#111] border border-[#222] rounded flex items-center px-2 text-[#444] animate-pulse">LOADING...</div>
                ) : (
                  <Select value={ticker} onValueChange={setTicker}>
                    <SelectTrigger className="h-7 bg-black border-[#222] text-[#E5E5E5] text-xs">
                      <SelectValue placeholder="TICKER" />
                    </SelectTrigger>
                    <SelectContent className="bg-black border-[#222]">
                      {availableTickers.map(t => (
                        <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-[#555] uppercase">Timeframe</label>
                <Select value={timeframe} onValueChange={(v) => setTimeframe(v as any)}>
                  <SelectTrigger className="h-7 bg-black border-[#222] text-[#E5E5E5] text-xs">
                    <SelectValue placeholder="TIMEFRAME" />
                  </SelectTrigger>
                  <SelectContent className="bg-black border-[#222]">
                    <SelectItem value="1d" className="text-xs">Daily (1d)</SelectItem>
                    <SelectItem value="1h" className="text-xs">1 Hour (1h)</SelectItem>
                    <SelectItem value="30m" className="text-xs">30 Min (30m)</SelectItem>
                    <SelectItem value="15m" className="text-xs">15 Min (15m)</SelectItem>
                    <SelectItem value="5m" className="text-xs">5 Min (5m)</SelectItem>
                    <SelectItem value="1m" className="text-xs">1 Min (1m)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-[#555] uppercase">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  min={tickerDateRange?.minDate}
                  max={tickerDateRange?.maxDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs w-full"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-[#555] uppercase">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  min={tickerDateRange?.minDate}
                  max={tickerDateRange?.maxDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs w-full"
                />
              </div>
            </div>

            {tickerDateRange && (
              <div className="flex flex-col gap-1 mt-1 bg-black/40 border border-[#15151A] p-2 rounded">
                <div className="flex justify-between items-center text-[9px]">
                  <span className="text-[#555] uppercase font-bold">Data Range:</span>
                  <span className="text-[#E5E5E5] font-semibold">{tickerDateRange.minDate} to {tickerDateRange.maxDate}</span>
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  {[1, 3, 5, 10].map((yr) => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => applyDatePreset(yr)}
                      className="flex-1 py-1 bg-[#111] hover:bg-[#1C202E]/60 border border-[#222] hover:border-terminal-green/45 text-[9px] font-bold text-[#888] hover:text-terminal-green rounded transition-all"
                    >
                      {yr}Y Preset
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-[#555] uppercase">Capital ($)</label>
                <input
                  type="number"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(parseInt(e.target.value) || 10000)}
                  className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-[#555] uppercase">Comm ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={commission}
                  onChange={(e) => setCommission(parseFloat(e.target.value) || 0)}
                  className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-[#555] uppercase">Slippage (%)</label>
                <input
                  type="number"
                  step="0.01"
                  value={slippagePercent}
                  onChange={(e) => setSlippagePercent(parseFloat(e.target.value) || 0)}
                  className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1 mt-3">
              <label className="text-[9px] text-[#555] uppercase">Strategy Direction</label>
              <Select value={strategyType} onValueChange={(v) => setStrategyType(v as any)}>
                <SelectTrigger className="h-7 bg-black border-[#222] text-[#E5E5E5] text-xs">
                  <SelectValue placeholder="DIRECTION" />
                </SelectTrigger>
                <SelectContent className="bg-black border-[#222]">
                  <SelectItem value="both" className="text-xs">Both (Long & Short)</SelectItem>
                  <SelectItem value="long" className="text-xs">Long Only</SelectItem>
                  <SelectItem value="short" className="text-xs">Short Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {/* Column 2: Risk Parameters */}
          <div className="space-y-4">
            <h4 className="text-[10px] font-bold text-terminal-green uppercase border-b border-[#1A1A1E] pb-1">RISK MANAGEMENT</h4>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-[#555] uppercase flex items-center gap-1">
                  Stop Loss (%)
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger><HelpCircle className="w-3 h-3 text-[#555]" /></TooltipTrigger>
                      <TooltipContent className="bg-black border-[#222] text-xs font-mono text-[#949494]">
                        Exits trade if price drops below entry by this %
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={stopLossPercent ?? ''}
                  onChange={(e) => setStopLossPercent(parseFloat(e.target.value) || undefined)}
                  className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono"
                  placeholder="Disable"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-[#555] uppercase flex items-center gap-1">
                  Trailing Stop (%)
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger><HelpCircle className="w-3 h-3 text-[#555]" /></TooltipTrigger>
                      <TooltipContent className="bg-black border-[#222] text-xs font-mono text-[#949494]">
                        Exits trade if price falls from peak by this %
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={trailingStopPercent ?? ''}
                  onChange={(e) => setTrailingStopPercent(parseFloat(e.target.value) || undefined)}
                  className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono"
                  placeholder="Disable"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-[#555] uppercase flex items-center gap-1">
                  Take Profit (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={takeProfitPercent ?? ''}
                  onChange={(e) => setTakeProfitPercent(parseFloat(e.target.value) || undefined)}
                  className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono"
                  placeholder="Disable"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-[#555] uppercase flex items-center gap-1">
                  Max Held Bars
                </label>
                <input
                  type="number"
                  value={timeBasedExitDays ?? ''}
                  onChange={(e) => setTimeBasedExitDays(parseInt(e.target.value) || undefined)}
                  className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs font-mono"
                  placeholder="Disable"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Indicators */}
      {activeTab === 'indicators' && (
        <div className="space-y-4">
          <h4 className="text-[10px] font-bold text-terminal-green uppercase border-b border-[#1A1A1E] pb-1">TECHNICAL INDICATORS</h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-[180px] overflow-y-auto pr-1 terminal-scrollbar">
            {indicators.length === 0 ? (
              <div className="col-span-full text-[9px] text-[#444] italic p-3 border border-dashed border-[#222] rounded text-center">
                No indicators added yet.
              </div>
            ) : (
              indicators.map((ind, idx) => (
                <div key={idx} className="flex items-center justify-between bg-black border border-[#15151A] rounded-lg p-2 hover:border-[#222] transition-colors">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-[#E5E5E5] font-bold uppercase">{ind.type}</span>
                    <span className="text-[9px] text-[#666]">
                      Period: {ind.period1}
                      {ind.period2 && ` / Slow: ${ind.period2}`}
                      {ind.signalPeriod && ` / Sig: ${ind.signalPeriod}`}
                      {ind.stdDev && ` / Dev: ${ind.stdDev}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeIndicator(idx)}
                    className="w-7 h-7 flex items-center justify-center text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Add Indicator Builder Row */}
          <div className="flex flex-wrap gap-3 items-end bg-[#0A0A0C] border border-[#1A1A1E] p-3 rounded-lg">
            <div className="flex-1 min-w-[120px] flex flex-col gap-1">
              <label className="text-[8px] text-[#555] uppercase">Type</label>
              <Select value={newIndType} onValueChange={(v) => setNewIndType(v as any)}>
                <SelectTrigger className="h-7 bg-black border-[#222] text-[#E5E5E5] text-xs">
                  <SelectValue placeholder="TYPE" />
                </SelectTrigger>
                <SelectContent className="bg-black border-[#222]">
                  <SelectItem value="sma" className="text-xs">SMA</SelectItem>
                  <SelectItem value="ema" className="text-xs">EMA</SelectItem>
                  <SelectItem value="rsi" className="text-xs">RSI</SelectItem>
                  <SelectItem value="macd" className="text-xs">MACD</SelectItem>
                  <SelectItem value="bb" className="text-xs">B Bands</SelectItem>
                  <SelectItem value="atr" className="text-xs">ATR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="w-20 flex flex-col gap-1">
              <label className="text-[8px] text-[#555] uppercase">Period</label>
              <input
                type="number"
                value={newIndPeriod}
                onChange={(e) => setNewIndPeriod(parseInt(e.target.value) || 14)}
                className="h-7 bg-black border border-[#222] rounded px-2 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
              />
            </div>
            
            <button
              type="button"
              onClick={addIndicator}
              className="h-7 px-4 bg-terminal-green/10 border border-terminal-green/30 text-terminal-green hover:bg-terminal-green/20 rounded flex items-center justify-center gap-1.5 font-bold uppercase text-[10px] tracking-wider transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> Add Indicator
            </button>
          </div>
        </div>
      )}

      {/* Tab 3: Rules & Triggers */}
      {activeTab === 'triggers' && (
        <div className="grid grid-cols-1 gap-6">
          {/* Entry Rules Column */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#1A1A1E] pb-1.5">
              <h4 className="text-[10px] font-bold text-[#10B981] uppercase">ENTRY CONDITIONS (AND)</h4>
              <button
                type="button"
                onClick={addEntryRule}
                className="text-terminal-green flex items-center gap-0.5 hover:text-terminal-green/80 text-[9px] font-bold"
              >
                <Plus className="w-3 h-3" /> ADD RULE
              </button>
            </div>

            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 terminal-scrollbar">
              {entryRules.length === 0 ? (
                <div className="text-[9px] text-[#444] italic p-3 border border-dashed border-[#222] rounded text-center">
                  No entry rules defined.
                </div>
              ) : (
                entryRules.map((rule, idx) => (
                  <StrategyConditionBlock
                    key={idx}
                    idx={idx}
                    rule={rule}
                    indicatorKeys={indicatorKeys}
                    type="entry"
                    onUpdate={(updated) => {
                      const updatedRules = [...entryRules];
                      updatedRules[idx] = updated;
                      setEntryRules(updatedRules);
                    }}
                    onRemove={() => removeEntryRule(idx)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Exit Rules Column */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#1A1A1E] pb-1.5">
              <h4 className="text-[10px] font-bold text-[#EF4444] uppercase">EXIT CONDITIONS (OR)</h4>
              <button
                type="button"
                onClick={addExitRule}
                className="text-terminal-green flex items-center gap-0.5 hover:text-terminal-green/80 text-[9px] font-bold"
              >
                <Plus className="w-3 h-3" /> ADD RULE
              </button>
            </div>

            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 terminal-scrollbar">
              {exitRules.length === 0 ? (
                <div className="text-[9px] text-[#444] italic p-3 border border-dashed border-[#222] rounded text-center">
                  No technical exit rules.
                </div>
              ) : (
                exitRules.map((rule, idx) => (
                  <StrategyConditionBlock
                    key={idx}
                    idx={idx}
                    rule={rule}
                    indicatorKeys={indicatorKeys}
                    type="exit"
                    onUpdate={(updated) => {
                      const updatedRules = [...exitRules];
                      updatedRules[idx] = updated;
                      setExitRules(updatedRules);
                    }}
                    onRemove={() => removeExitRule(idx)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
