"use client"

import React, { useState } from 'react';
import { IndicatorCondition } from '../../backend/src/backtester/types';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface StrategyConditionBlockProps {
  idx: number;
  rule: IndicatorCondition;
  indicatorKeys: string[];
  type: 'entry' | 'exit';
  onUpdate: (updatedRule: IndicatorCondition) => void;
  onRemove: () => void;
}

export function StrategyConditionBlock({
  idx,
  rule,
  indicatorKeys,
  type,
  onUpdate,
  onRemove
}: StrategyConditionBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isEntry = type === 'entry';
  const accentColor = isEntry ? '#10B981' : '#EF4444'; // green vs red
  const accentBg = isEntry ? 'rgba(16, 185, 129, 0.03)' : 'rgba(239, 68, 68, 0.03)';
  const borderStyle = { borderColor: isEntry ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)' };

  // Generate a clean summary text, e.g. "close crosses_above sma_20"
  const getSummaryText = () => {
    let op = rule.operator as string;
    if (op === 'greater_than') op = '>';
    else if (op === 'less_than') op = '<';
    else if (op === 'equals') op = '=';
    else if (op === 'crosses_above') op = 'crosses above';
    else if (op === 'crosses_below') op = 'crosses below';

    return `${rule.indicator1} ${op} ${rule.indicator2}`;
  };

  return (
    <div 
      className="border rounded-md overflow-hidden relative transition-all duration-150"
      style={{ ...borderStyle, backgroundColor: accentBg }}
    >
      {/* Header bar (collapsed summary view) */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between p-2.5 cursor-pointer hover:bg-black/20 select-none"
      >
        <div className="flex items-center gap-2 font-mono text-[11px] text-[#E5E5E5] truncate pr-8">
          <div 
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: accentColor }}
          />
          <span className="font-bold text-[9px] uppercase tracking-wider text-gray-500 mr-1">
            {type} #{idx + 1}:
          </span>
          <span className="truncate">{getSummaryText()}</span>
        </div>
        
        <div className="flex items-center gap-1 shrink-0 z-10" onClick={(e) => e.stopPropagation()}>
          {/* Delete Button - Aligned cleanly */}
          <button
            type="button"
            onClick={onRemove}
            className="w-6 h-6 flex items-center justify-center text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all mr-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          
          {/* Expand Toggle */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-white rounded"
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded parameter form */}
      {isExpanded && (
        <div className="p-3 border-t border-[#131316] bg-black/60 flex flex-col gap-3 font-mono text-[10px]">
          <div className="grid grid-cols-3 gap-2">
            
            {/* Left Operand Select */}
            <div className="flex flex-col gap-1">
              <label className="text-[8px] text-gray-500 uppercase">Left Operand</label>
              <Select
                value={rule.indicator1}
                onValueChange={(val) => onUpdate({ ...rule, indicator1: val })}
              >
                <SelectTrigger className="h-6 bg-black border-[#222] text-[#E5E5E5] text-[10px] px-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-black border-[#222]">
                  {indicatorKeys.map(k => (
                    <SelectItem key={k} value={k} className="text-[10px]">{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Operator Select */}
            <div className="flex flex-col gap-1">
              <label className="text-[8px] text-gray-500 uppercase">Operator</label>
              <Select
                value={rule.operator}
                onValueChange={(val: any) => onUpdate({ ...rule, operator: val })}
              >
                <SelectTrigger className="h-6 bg-black border-[#222] text-[#E5E5E5] text-[10px] px-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-black border-[#222]">
                  <SelectItem value="greater_than" className="text-[10px]">&gt; (Greater)</SelectItem>
                  <SelectItem value="less_than" className="text-[10px]">&lt; (Less)</SelectItem>
                  <SelectItem value="equals" className="text-[10px]">= (Equals)</SelectItem>
                  <SelectItem value="crosses_above" className="text-[10px]">Crosses Over</SelectItem>
                  <SelectItem value="crosses_below" className="text-[10px]">Crosses Under</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Right Operand Input */}
            <div className="flex flex-col gap-1">
              <label className="text-[8px] text-gray-500 uppercase">Right Operand</label>
              <input
                type="text"
                value={rule.indicator2}
                onChange={(e) => {
                  const val = e.target.value;
                  const num = parseFloat(val);
                  onUpdate({
                    ...rule,
                    indicator2: isNaN(num) ? val : num
                  });
                }}
                className="h-6 bg-black border border-[#222] rounded px-1.5 text-[#E5E5E5] outline-none focus:border-terminal-green/30 text-[10px] w-full"
                placeholder="Indicator or #"
              />
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}
