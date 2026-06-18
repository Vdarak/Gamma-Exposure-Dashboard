"use client"

import React from 'react';
import { IndicatorConfig, IndicatorCondition } from '../../backend/src/backtester/types';
import { X, Play, ShieldAlert, ArrowRightLeft, BookOpen, Terminal } from 'lucide-react';
import { StrategyConditionBlock } from './strategy-condition-block';

interface StrategyTerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
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

export function StrategyTerminalDrawer({
  isOpen,
  onClose,
  entryRules,
  setEntryRules,
  exitRules,
  setExitRules,
  indicators,
  stopLossPercent,
  takeProfitPercent,
  trailingStopPercent,
  timeBasedExitDays,
  onSubmit,
  isRunning
}: StrategyTerminalDrawerProps) {
  if (!isOpen) return null;

  // Generate indicator keys
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
      } else if (ind.type === 'bb') {
        const dev = ind.stdDev || 2;
        keys.push(`bb_upper_${ind.period1}_${dev}`);
        keys.push(`bb_middle_${ind.period1}_${dev}`);
        keys.push(`bb_lower_${ind.period1}_${dev}`);
      }
    });
    return keys;
  };

  const indicatorKeys = getIndicatorKeys();

  // Pseudocode Strategy Description
  const getStrategyPseudocode = () => {
    const entryDesc = entryRules.length > 0 
      ? entryRules.map(r => `${r.indicator1} ${r.operator.replace('_', ' ')} ${r.indicator2}`).join('\n  AND ')
      : 'No entry conditions defined';

    const exitIndicatorDesc = exitRules.length > 0
      ? exitRules.map(r => `${r.indicator1} ${r.operator.replace('_', ' ')} ${r.indicator2}`).join('\n  AND ')
      : null;

    const riskExits: string[] = [];
    if (stopLossPercent) riskExits.push(`Stop Loss: price hits -${stopLossPercent}%`);
    if (trailingStopPercent) riskExits.push(`Trailing Stop: price falls ${trailingStopPercent}% from peak`);
    if (takeProfitPercent) riskExits.push(`Take Profit: price hits +${takeProfitPercent}%`);
    if (timeBasedExitDays) riskExits.push(`Max Held Bars: ${timeBasedExitDays} bars`);

    const riskDesc = riskExits.length > 0 ? riskExits.join('\n  OR ') : 'None configured';

    return `// ==========================================
// BACKTESTING STRATEGY SPECIFICATION
// ==========================================

ENTER LONG WHEN:
  ${entryDesc}

EXIT LONG WHEN:
  ${exitIndicatorDesc ? `( ${exitIndicatorDesc} )\n  OR ` : ''}${riskDesc}`;
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

  return (
    <div className="absolute inset-0 bg-[#020203] z-45 flex flex-col font-mono text-[#949494] text-xs select-none">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-[#08080A] border-b border-[#15151A] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-terminal-green" />
          <div>
            <h2 className="text-xs font-bold text-[#E5E5E5] tracking-widest uppercase">Strategy Terminal Workspace</h2>
            <p className="text-[9px] text-[#555] mt-0.5">Dual-column strategy editor & logic validator</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onSubmit}
            disabled={isRunning}
            className="flex items-center gap-2 h-8 px-4 bg-terminal-green/10 border border-terminal-green/30 text-terminal-green hover:bg-terminal-green/20 rounded font-bold transition-all disabled:opacity-40"
          >
            <Play className="w-3.5 h-3.5" />
            <span>RUN BACKTEST</span>
          </button>
          
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center bg-[#1C202E]/20 hover:bg-[#1C202E]/40 border border-[#2B3045]/20 hover:border-[#2B3045]/40 text-gray-400 hover:text-white rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main split content */}
      <div className="flex-1 flex flex-row p-6 overflow-hidden min-h-0 gap-6">
        
        {/* COLUMN 1: ENTRY RULES */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#08080A]/60 border border-[#15151A] rounded-lg p-4 h-full">
          <div className="flex items-center justify-between border-b border-[#15151A] pb-2 mb-4">
            <h3 className="text-xs font-bold text-[#10B981] uppercase flex items-center gap-1.5">
              <ArrowRightLeft className="w-4 h-4 text-[#10B981]" />
              <span>Entry Conditions (AND)</span>
            </h3>
            <button
              onClick={addEntryRule}
              className="px-2 py-1 bg-[#10B981]/15 text-[#10B981] hover:bg-[#10B981]/25 border border-[#10B981]/30 rounded text-[9px] font-bold tracking-wider"
            >
              + ADD RULE
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1.5 terminal-scrollbar max-h-[calc(100vh-210px)]">
            {entryRules.length === 0 ? (
              <div className="text-center py-12 text-[#444] italic border border-dashed border-[#222] rounded-lg">
                No entry rules defined. Click + ADD RULE to start.
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
                    const newRules = [...entryRules];
                    newRules[idx] = updated;
                    setEntryRules(newRules);
                  }}
                  onRemove={() => removeEntryRule(idx)}
                />
              ))
            )}
          </div>
        </div>

        {/* COLUMN 2: EXIT RULES */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#08080A]/60 border border-[#15151A] rounded-lg p-4 h-full">
          <div className="flex items-center justify-between border-b border-[#15151A] pb-2 mb-4">
            <h3 className="text-xs font-bold text-[#EF4444] uppercase flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-[#EF4444]" />
              <span>Exit Conditions (AND)</span>
            </h3>
            <button
              onClick={addExitRule}
              className="px-2 py-1 bg-[#EF4444]/15 text-[#EF4444] hover:bg-[#EF4444]/25 border border-[#EF4444]/30 rounded text-[9px] font-bold tracking-wider"
            >
              + ADD RULE
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1.5 terminal-scrollbar max-h-[calc(100vh-210px)]">
            {exitRules.length === 0 ? (
              <div className="text-center py-12 text-[#444] italic border border-dashed border-[#222] rounded-lg">
                No exit rules defined. Click + ADD RULE to start.
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
                    const newRules = [...exitRules];
                    newRules[idx] = updated;
                    setExitRules(newRules);
                  }}
                  onRemove={() => removeExitRule(idx)}
                />
              ))
            )}
          </div>
        </div>

        {/* COLUMN 3: PSEUDO CODE SUMMARY */}
        <div className="w-[340px] flex flex-col bg-[#0A0C10]/80 border border-[#15151A] rounded-lg p-4 h-full shrink-0 select-text">
          <h3 className="text-xs font-bold text-[#F5F5F7] uppercase tracking-wider flex items-center gap-1.5 border-b border-[#15151A] pb-2 mb-4">
            <BookOpen className="w-4 h-4 text-terminal-green" />
            <span>Logic Pseudocode</span>
          </h3>

          <div className="flex-1 bg-black/80 border border-[#131316] rounded-md p-4 font-mono text-[10px] leading-relaxed text-[#10B981] overflow-y-auto whitespace-pre">
            {getStrategyPseudocode()}
          </div>
        </div>

      </div>
    </div>
  );
}
