"use client"

import React from 'react';
import { BacktestResult } from '../../backend/src/backtester/types';

interface BacktestMetricsGridProps {
  result: BacktestResult;
}

export function BacktestMetricsGrid({ result }: BacktestMetricsGridProps) {
  const isPnlPositive = result.finalCapital >= result.initialCapital;
  const netPnl = result.finalCapital - result.initialCapital;
  const pnlPercent = (netPnl / result.initialCapital) * 100;

  const stats = [
    {
      label: 'Net Profit',
      value: `${isPnlPositive ? '+' : ''}$${netPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
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
      label: 'Max Drawdown',
      value: `-${result.maxDrawdownPercent.toFixed(2)}%`,
      subText: 'Peak-to-Valley Decline',
      valueColor: 'text-[#FF3B60]',
    },
    {
      label: 'Profit Factor',
      value: `${result.profitFactor.toFixed(2)}x`,
      subText: 'Gross Profit / Gross Loss',
      valueColor: 'text-white',
    },
    {
      label: 'Total Trades',
      value: result.totalTrades.toString(),
      subText: 'Executed Transactions',
      valueColor: 'text-white',
    }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5 flex-shrink-0">
      {stats.map((stat, idx) => (
        <div 
          key={idx} 
          className="bg-[#050507] border border-[#1A1A1E] rounded-lg pt-2.5 pb-3 px-4 flex flex-col justify-between h-20 hover:border-[#25252E] transition-all"
        >
          <span className="text-[9px] font-bold text-[#A3A3A3] uppercase tracking-wider">
            {stat.label}
          </span>
          <div className="flex flex-col">
            <div className={`text-xl font-bold font-data leading-none ${stat.valueColor}`}>
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
}
