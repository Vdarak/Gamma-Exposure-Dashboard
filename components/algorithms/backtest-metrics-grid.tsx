"use client"

import React, { useState } from 'react';
import { BacktestResult } from '../../backend/src/backtester/types';

interface BacktestMetricsGridProps {
  result: BacktestResult;
}

export function BacktestMetricsGrid({ result }: BacktestMetricsGridProps) {
  const [activeTab, setActiveTab] = useState<'performance' | 'trades' | 'drawdown'>('performance');
  
  const isPnlPositive = result.totalPnl >= 0;
  const pnlPercent = (result.totalPnl / result.initialCapital) * 100;

  const renderCard = (stat: {
    label: string;
    value: string;
    valueColor: string;
    bottomSection?: React.ReactNode;
  }, idx: number) => {
    const isLongValue = stat.value.length > 8;
    return (
      <div 
        key={idx} 
        className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2 pb-3 px-4 flex flex-col justify-between h-[94px] hover:border-[#25252E] transition-all"
      >
        <span className="text-[9px] font-bold text-[#949494] uppercase tracking-wider font-mono">
          {stat.label}
        </span>
        <div className="flex flex-col flex-1 justify-center mt-1">
          <div className={`font-bold font-data leading-none ${stat.valueColor} ${isLongValue ? 'text-[11px] font-mono truncate' : 'text-2xl'}`} title={stat.value}>
            {stat.value}
          </div>
        </div>
        {stat.bottomSection}
      </div>
    );
  };

  const renderPerformanceTab = () => {
    const stats = [
      {
        label: 'Net Profit',
        value: `${isPnlPositive ? '+' : ''}$${result.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        valueColor: isPnlPositive ? 'text-[#00C805]' : 'text-[#FF3B60]',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              {isPnlPositive ? `${pnlPercent.toFixed(2)}% Return` : `${pnlPercent.toFixed(2)}% Return`}
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: `${Math.min(100, Math.max(0, Math.abs(pnlPercent)))}%` }} className={`h-full ${isPnlPositive ? 'bg-[#00C805]' : 'bg-[#FF3B60]'}`} />
            </div>
          </div>
        )
      },
      {
        label: 'Win Rate',
        value: `${result.winRate.toFixed(1)}%`,
        valueColor: 'text-white',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <div className="flex justify-between text-[8px] text-[#A3A3A3] font-bold">
              <span>{result.winningTrades} WINS</span>
              <span>{result.losingTrades} LOSSES</span>
            </div>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden flex">
              <div style={{ width: `${result.winRate}%` }} className="bg-[#00C805] h-full" />
              <div style={{ width: `${100 - result.winRate}%` }} className="bg-[#FF3B60] h-full" />
            </div>
          </div>
        )
      },
      {
        label: 'Sharpe Ratio',
        value: result.sharpeRatio.toFixed(2),
        valueColor: 'text-terminal-cyan',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              {result.sharpeRatio > 2 ? 'Excellent' : result.sharpeRatio > 1 ? 'Good' : 'Suboptimal'} Edge
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: `${Math.min(100, Math.max(0, (result.sharpeRatio / 3) * 100))}%` }} className="bg-[#00D4FF] h-full" />
            </div>
          </div>
        )
      },
      {
        label: 'Profit Factor',
        value: `${result.profitFactor.toFixed(2)}x`,
        valueColor: 'text-white',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              PF: Gross Win vs Loss
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: `${Math.min(100, Math.max(0, (result.profitFactor / 3) * 100))}%` }} className="bg-[#00C805] h-full" />
            </div>
          </div>
        )
      },
      {
        label: 'Calmar Ratio (Return/DD)',
        value: `${result.returnToDrawdown.toFixed(2)}x`,
        valueColor: 'text-terminal-amber',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              Calmar: Return / Max DD
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: `${Math.min(100, Math.max(0, (result.returnToDrawdown / 5) * 100))}%` }} className="bg-terminal-amber h-full" />
            </div>
          </div>
        )
      },
      {
        label: 'Expectancy',
        value: `${result.expectancy >= 0 ? '+' : ''}$${result.expectancy.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        valueColor: result.expectancy >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <div className="flex justify-between text-[8px] text-[#A3A3A3] font-bold">
              <span>W Avg</span>
              <span>L Avg</span>
            </div>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden flex">
              <div style={{ width: `${result.avgWin / (result.avgWin + result.avgLoss || 1) * 100}%` }} className="bg-[#00C805] h-full" />
              <div style={{ width: `${result.avgLoss / (result.avgWin + result.avgLoss || 1) * 100}%` }} className="bg-[#FF3B60] h-full" />
            </div>
          </div>
        )
      }
    ];

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {stats.map((stat, idx) => renderCard(stat, idx))}
      </div>
    );
  };

  const renderTradesTab = () => {
    const stats = [
      {
        label: 'Total Trades',
        value: result.totalTrades.toString(),
        valueColor: 'text-white',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              Positions Closed Count
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: '100%' }} className="bg-white/20 h-full" />
            </div>
          </div>
        )
      },
      {
        label: 'Avg P&L',
        value: `${result.avgPnl >= 0 ? '+' : ''}$${result.avgPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        valueColor: result.avgPnl >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              {result.avgPnlPercent >= 0 ? '+' : ''}{result.avgPnlPercent.toFixed(2)}% Avg Trade
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: `${Math.min(100, Math.max(0, Math.abs(result.avgPnlPercent) * 20))}%` }} className={`h-full ${result.avgPnl >= 0 ? 'bg-[#00C805]' : 'bg-[#FF3B60]'}`} />
            </div>
          </div>
        )
      },
      {
        label: 'Median P&L',
        value: `${result.medianPnl >= 0 ? '+' : ''}$${result.medianPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        valueColor: result.medianPnl >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              Middle Trade Performance
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: `${Math.min(100, Math.max(0, Math.abs(result.medianPnl / (result.avgPnl || 1)) * 50))}%` }} className={`h-full ${result.medianPnl >= 0 ? 'bg-[#00C805]' : 'bg-[#FF3B60]'}`} />
            </div>
          </div>
        )
      },
      {
        label: 'Avg Win / Loss',
        value: `+$${result.avgWin.toLocaleString(undefined, { maximumFractionDigits: 0 })} / -$${result.avgLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        valueColor: 'text-white',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <div className="flex justify-between text-[8px] text-[#A3A3A3] font-bold">
              <span>W Avg</span>
              <span>L Avg</span>
            </div>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden flex">
              <div style={{ width: `${result.avgWin / (result.avgWin + result.avgLoss || 1) * 100}%` }} className="bg-[#00C805] h-full" />
              <div style={{ width: `${result.avgLoss / (result.avgWin + result.avgLoss || 1) * 100}%` }} className="bg-[#FF3B60] h-full" />
            </div>
          </div>
        )
      },
      {
        label: 'Largest Win',
        value: `+$${result.largestWin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        valueColor: 'text-[#00C805]',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              Best Single Position P&L
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: '100%' }} className="bg-[#00C805] h-full" />
            </div>
          </div>
        )
      },
      {
        label: 'Largest Loss',
        value: `-$${Math.abs(result.largestLoss).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        valueColor: 'text-[#FF3B60]',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              Worst Single Position P&L
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: '100%' }} className="bg-[#FF3B60] h-full" />
            </div>
          </div>
        )
      }
    ];

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {stats.map((stat, idx) => renderCard(stat, idx))}
      </div>
    );
  };

  const renderDrawdownTab = () => {
    const recoveryStr = result.ddRecovery === 'Unrecovered' ? 'Active / Unrecovered' : result.ddRecovery;
    
    const stats = [
      {
        label: 'Max Drawdown',
        value: `-${result.maxDrawdownPercent.toFixed(2)}%`,
        valueColor: 'text-[#FF3B60]',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              Peak-to-Valley decline
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: `${Math.min(100, result.maxDrawdownPercent)}%` }} className="bg-[#FF3B60] h-full" />
            </div>
          </div>
        )
      },
      {
        label: 'Drawdown Start',
        value: result.ddStart || 'N/A',
        valueColor: 'text-white',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              Date of preceding peak
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: '100%' }} className="bg-white/20 h-full" />
            </div>
          </div>
        )
      },
      {
        label: 'Drawdown Valley',
        value: result.ddEnd || 'N/A',
        valueColor: 'text-white',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              Lowest Equity Valley Trough
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: '100%' }} className="bg-[#FF3B60]/40 h-full" />
            </div>
          </div>
        )
      },
      {
        label: 'Drawdown Recovery',
        value: recoveryStr,
        valueColor: result.ddRecovery === 'Unrecovered' ? 'text-terminal-amber' : 'text-[#00C805]',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              {result.ddRecovery === 'Unrecovered' ? 'In Drawdown' : 'Fully Recovered'}
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: '100%' }} className={`h-full ${result.ddRecovery === 'Unrecovered' ? 'bg-terminal-amber' : 'bg-[#00C805]'}`} />
            </div>
          </div>
        )
      },
      {
        label: 'Drawdown Duration',
        value: `${result.ddDurationDays} Days`,
        valueColor: 'text-white',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <span className="text-[8px] text-[#A3A3A3] font-bold uppercase truncate">
              {result.ddDurationBars} bars held in drawdown
            </span>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden">
              <div style={{ width: `${Math.min(100, result.ddDurationBars)}%` }} className="bg-white/20 h-full" />
            </div>
          </div>
        )
      },
      {
        label: 'Streaks (Win / Loss)',
        value: `${result.winningStreak} W / ${result.losingStreak} L`,
        valueColor: 'text-white',
        bottomSection: (
          <div className="flex flex-col gap-1 w-full font-mono mt-1">
            <div className="flex justify-between text-[8px] text-[#A3A3A3] font-bold">
              <span>MAX W: {result.winningStreak}</span>
              <span>MAX L: {result.losingStreak}</span>
            </div>
            <div className="h-1 w-full bg-black rounded-full overflow-hidden flex">
              <div style={{ width: `${result.winningStreak / (result.winningStreak + result.losingStreak || 1) * 100}%` }} className="bg-[#00C805] h-full" />
              <div style={{ width: `${result.losingStreak / (result.winningStreak + result.losingStreak || 1) * 100}%` }} className="bg-[#FF3B60] h-full" />
            </div>
          </div>
        )
      }
    ];

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {stats.map((stat, idx) => renderCard(stat, idx))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 flex-shrink-0">
      {/* Sub-Tabs Selector */}
      <div className="flex border-b border-[#131316] gap-2 pb-1.5">
        <button
          type="button"
          onClick={() => setActiveTab('performance')}
          className={`px-3 py-1 rounded text-[10px] font-bold font-mono transition-all uppercase ${
            activeTab === 'performance' ? 'bg-[#1A1A1E] text-terminal-green' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Performance Summary
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('trades')}
          className={`px-3 py-1 rounded text-[10px] font-bold font-mono transition-all uppercase ${
            activeTab === 'trades' ? 'bg-[#1A1A1E] text-terminal-green' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Trade Details
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('drawdown')}
          className={`px-3 py-1 rounded text-[10px] font-bold font-mono transition-all uppercase ${
            activeTab === 'drawdown' ? 'bg-[#1A1A1E] text-terminal-green' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Drawdowns & Streaks
        </button>
      </div>

      {/* Grid Content */}
      {activeTab === 'performance' && renderPerformanceTab()}
      {activeTab === 'trades' && renderTradesTab()}
      {activeTab === 'drawdown' && renderDrawdownTab()}
    </div>
  );
}
