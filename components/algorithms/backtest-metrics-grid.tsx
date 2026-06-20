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

  const renderPerformanceTab = () => {
    const stats = [
      {
        label: 'Net Profit',
        value: `${isPnlPositive ? '+' : ''}$${result.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: `${isPnlPositive ? '+' : ''}${pnlPercent.toFixed(2)}% Return`,
        valueColor: isPnlPositive ? 'text-[#00C805]' : 'text-[#FF3B60]',
      },
      {
        label: 'Win Rate',
        value: `${result.winRate.toFixed(1)}%`,
        subText: `${result.winningTrades} Wins / ${result.losingTrades} Losses`,
        valueColor: 'text-white',
      },
      {
        label: 'Sharpe Ratio',
        value: result.sharpeRatio.toFixed(2),
        subText: 'Annualized Risk-Adjusted',
        valueColor: 'text-terminal-cyan',
      },
      {
        label: 'Profit Factor',
        value: `${result.profitFactor.toFixed(2)}x`,
        subText: 'Gross Profit / Gross Loss',
        valueColor: 'text-white',
      },
      {
        label: 'Calmar Ratio (Return/DD)',
        value: `${result.returnToDrawdown.toFixed(2)}x`,
        subText: 'Ratio of Return to Max DD',
        valueColor: 'text-terminal-amber',
      },
      {
        label: 'Expectancy',
        value: `${result.expectancy >= 0 ? '+' : ''}$${result.expectancy.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: 'Expected outcome per trade',
        valueColor: result.expectancy >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]',
      }
    ];

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {stats.map((stat, idx) => (
          <div 
            key={idx} 
            className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2.5 pb-3 px-4 flex flex-col justify-between h-20 hover:border-[#25252E] transition-all"
          >
            <span className="text-[9px] font-bold text-[#A3A3A3] uppercase tracking-wider">
              {stat.label}
            </span>
            <div className="flex flex-col">
              <div className={`text-lg font-bold font-data leading-none ${stat.valueColor}`}>
                {stat.value}
              </div>
              <span className="text-[9px] text-[#555] font-mono mt-1">
                {stat.subText}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderTradesTab = () => {
    const stats = [
      {
        label: 'Total Trades',
        value: result.totalTrades.toString(),
        subText: 'Closed positions count',
        valueColor: 'text-white',
      },
      {
        label: 'Avg P&L',
        value: `${result.avgPnl >= 0 ? '+' : ''}$${result.avgPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: `${result.avgPnlPercent >= 0 ? '+' : ''}${result.avgPnlPercent.toFixed(2)}% Avg Trade`,
        valueColor: result.avgPnl >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]',
      },
      {
        label: 'Median P&L',
        value: `${result.medianPnl >= 0 ? '+' : ''}$${result.medianPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: 'Middle trade performance',
        valueColor: result.medianPnl >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]',
      },
      {
        label: 'Avg Win / Loss',
        value: `+$${result.avgWin.toLocaleString(undefined, { maximumFractionDigits: 0 })} / -$${result.avgLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        subText: `Wins Avg vs Losses Avg`,
        valueColor: 'text-white',
      },
      {
        label: 'Largest Win',
        value: `+$${result.largestWin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: 'Best single trade result',
        valueColor: 'text-[#00C805]',
      },
      {
        label: 'Largest Loss',
        value: `-$${Math.abs(result.largestLoss).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        subText: 'Worst single trade result',
        valueColor: 'text-[#FF3B60]',
      }
    ];

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {stats.map((stat, idx) => (
          <div 
            key={idx} 
            className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2.5 pb-3 px-4 flex flex-col justify-between h-20 hover:border-[#25252E] transition-all"
          >
            <span className="text-[9px] font-bold text-[#A3A3A3] uppercase tracking-wider">
              {stat.label}
            </span>
            <div className="flex flex-col">
              <div className={`text-lg font-bold font-data leading-none ${stat.valueColor}`}>
                {stat.value}
              </div>
              <span className="text-[9px] text-[#555] font-mono mt-1">
                {stat.subText}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderDrawdownTab = () => {
    const recoveryStr = result.ddRecovery === 'Unrecovered' ? 'Active / Unrecovered' : result.ddRecovery;
    
    const stats = [
      {
        label: 'Max Drawdown',
        value: `-${result.maxDrawdownPercent.toFixed(2)}%`,
        subText: 'Peak-to-Valley decline',
        valueColor: 'text-[#FF3B60]',
      },
      {
        label: 'Drawdown Start',
        value: result.ddStart || 'N/A',
        subText: 'Date of preceding peak',
        valueColor: 'text-white',
      },
      {
        label: 'Drawdown Valley',
        value: result.ddEnd || 'N/A',
        subText: 'Date of lowest equity trough',
        valueColor: 'text-white',
      },
      {
        label: 'Drawdown Recovery',
        value: recoveryStr,
        subText: 'Date back to peak level',
        valueColor: result.ddRecovery === 'Unrecovered' ? 'text-terminal-amber' : 'text-[#00C805]',
      },
      {
        label: 'Drawdown Duration',
        value: `${result.ddDurationDays} Days`,
        subText: `${result.ddDurationBars} bars held in drawdown`,
        valueColor: 'text-white',
      },
      {
        label: 'Streaks (Win / Loss)',
        value: `${result.winningStreak} W / ${result.losingStreak} L`,
        subText: 'Max consecutive trades',
        valueColor: 'text-white',
      }
    ];

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {stats.map((stat, idx) => (
          <div 
            key={idx} 
            className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2.5 pb-3 px-4 flex flex-col justify-between h-20 hover:border-[#25252E] transition-all"
          >
            <span className="text-[9px] font-bold text-[#A3A3A3] uppercase tracking-wider">
              {stat.label}
            </span>
            <div className="flex flex-col">
              <div className={`text-[10px] font-bold font-mono truncate leading-none ${stat.valueColor}`}>
                {stat.value}
              </div>
              <span className="text-[9px] text-[#555] font-mono mt-1">
                {stat.subText}
              </span>
            </div>
          </div>
        ))}
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
