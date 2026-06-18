"use client"

import React, { useState } from 'react';
import { IndicatorConfig, IndicatorCondition } from '../../backend/src/backtester/types';
import { Plus, Trash2, HelpCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StrategyConditionBlock } from './strategy-condition-block';

interface BacktestConfigFormProps {
  availableTickers: string[];
  isLoadingTickers: boolean;
  ticker: string;
  setTicker: (val: string) => void;
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

  // Local state for adding indicators
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

  const indicatorKeys = getIndicatorKeys();

  return (
    <form onSubmit={onSubmit} className="flex-1 flex flex-col p-4 space-y-5 font-mono text-[#949494] text-xs select-none">
      {/* ─── SECTION 1: GLOBAL SIMULATION SETTINGS ─── */}
      <div className="space-y-3">
        <h3 className="text-[10px] font-bold text-terminal-green uppercase border-b border-[#1A1A1E] pb-1">GLOBAL PARAMETERS</h3>
        
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
              onChange={(e) => setStartDate(e.target.value)}
              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-[#555] uppercase">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1 col-span-1">
            <label className="text-[9px] text-[#555] uppercase">Capital ($)</label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(parseInt(e.target.value) || 10000)}
              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1 col-span-1">
            <label className="text-[9px] text-[#555] uppercase">Comm ($)</label>
            <input
              type="number"
              step="0.01"
              value={commission}
              onChange={(e) => setCommission(parseFloat(e.target.value) || 0)}
              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1 col-span-1">
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
      </div>

      {/* ─── SECTION 2: INDICATORS PRECOMPUTATION ─── */}
      <div className="space-y-3">
        <h3 className="text-[10px] font-bold text-terminal-green uppercase border-b border-[#1A1A1E] pb-1">INDICATORS CONFIG</h3>
        
        {/* Indicators List */}
        <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-0.5 terminal-scrollbar">
          {indicators.length === 0 ? (
            <div className="text-[9px] text-[#444] italic p-1 border border-dashed border-[#222] rounded text-center">No indicators added yet</div>
          ) : (
            indicators.map((ind, idx) => (
              <div key={idx} className="flex items-center justify-between bg-black/40 border border-[#15151A] rounded p-1.5">
                <span className="text-xs text-[#E5E5E5] uppercase">
                  {ind.type}({ind.period1})
                </span>
                <button
                  type="button"
                  onClick={() => removeIndicator(idx)}
                  className="w-6 h-6 flex items-center justify-center text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add Indicator Form Block */}
        <div className="flex gap-2 items-end bg-[#0A0A0C] border border-[#1A1A1E] p-2 rounded">
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-[8px] text-[#555] uppercase">Type</label>
            <Select value={newIndType} onValueChange={(v) => setNewIndType(v as any)}>
              <SelectTrigger className="h-6 bg-black border-[#222] text-[#E5E5E5] text-[10px]">
                <SelectValue placeholder="TYPE" />
              </SelectTrigger>
              <SelectContent className="bg-black border-[#222]">
                <SelectItem value="sma" className="text-[10px]">SMA</SelectItem>
                <SelectItem value="ema" className="text-[10px]">EMA</SelectItem>
                <SelectItem value="rsi" className="text-[10px]">RSI</SelectItem>
                <SelectItem value="macd" className="text-[10px]">MACD</SelectItem>
                <SelectItem value="bb" className="text-[10px]">B Bands</SelectItem>
                <SelectItem value="atr" className="text-[10px]">ATR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="w-16 flex flex-col gap-1">
            <label className="text-[8px] text-[#555] uppercase">Period</label>
            <input
              type="number"
              value={newIndPeriod}
              onChange={(e) => setNewIndPeriod(parseInt(e.target.value) || 14)}
              className="h-6 bg-black border border-[#222] rounded px-1 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-[10px]"
            />
          </div>
          
          <button
            type="button"
            onClick={addIndicator}
            className="h-6 px-2 bg-terminal-green/10 border border-terminal-green/30 text-terminal-green hover:bg-terminal-green/20 rounded flex items-center justify-center gap-1 text-[10px]"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>

      {/* ─── SECTION 3: ENTRY RULES ─── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-[#1A1A1E] pb-1">
          <h3 className="text-[10px] font-bold text-[#10B981] uppercase">ENTRY CONDITIONS (AND)</h3>
          <button
            type="button"
            onClick={addEntryRule}
            className="text-terminal-green flex items-center gap-0.5 hover:text-terminal-green/80 text-[10px]"
          >
            <Plus className="w-3.5 h-3.5" /> Rule
          </button>
        </div>

        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-0.5 terminal-scrollbar">
          {entryRules.length === 0 ? (
            <div className="text-[9px] text-[#444] italic p-2 border border-dashed border-[#222] rounded text-center">No entry rules defined</div>
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

      {/* ─── SECTION 4: RISK MANAGEMENT EXITS ─── */}
      <div className="space-y-3">
        <h3 className="text-[10px] font-bold text-terminal-green uppercase border-b border-[#1A1A1E] pb-1">RISK EXITS</h3>
        
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
              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
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
              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
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
              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
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
              className="h-7 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-xs"
              placeholder="Disable"
            />
          </div>
        </div>
      </div>

      {/* ─── SECTION 5: EXIT RULE INDICATORS ─── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-[#1A1A1E] pb-1">
          <h3 className="text-[10px] font-bold text-[#EF4444] uppercase">EXIT CONDITIONS (AND)</h3>
          <button
            type="button"
            onClick={addExitRule}
            className="text-terminal-green flex items-center gap-0.5 hover:text-terminal-green/80 text-[10px]"
          >
            <Plus className="w-3.5 h-3.5" /> Rule
          </button>
        </div>

        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-0.5 terminal-scrollbar">
          {exitRules.length === 0 ? (
            <div className="text-[9px] text-[#444] italic p-2 border border-dashed border-[#222] rounded text-center">No exit rules defined</div>
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

      {/* ─── RUN BACKTEST SUBMIT BUTTON ─── */}
      <button
        type="submit"
        disabled={isRunning}
        className="w-full h-9 bg-terminal-green/10 border border-terminal-green/35 text-terminal-green hover:bg-terminal-green/20 disabled:bg-[#111] disabled:border-[#222] disabled:text-[#444] transition-all rounded text-xs font-mono font-bold tracking-widest uppercase mt-4"
      >
        {isRunning ? 'RUNNING PIPELINE...' : 'EXECUTE STRATEGY'}
      </button>
    </form>
  );
}
