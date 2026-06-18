"use client"

import React, { useState } from 'react';
import { TradeLog } from '../../backend/src/backtester/types';

interface BacktestTradeLogProps {
  trades: TradeLog[];
}

export function BacktestTradeLog({ trades }: BacktestTradeLogProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const tradesPerPage = 15;

  if (trades.length === 0) {
    return (
      <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-6 text-center font-mono text-xs text-[#555]">
        NO TRADES EXECUTED IN THIS BACKTEST PERIOD
      </div>
    );
  }

  // Pagination logic
  const totalPages = Math.ceil(trades.length / tradesPerPage);
  const indexOfLastTrade = currentPage * tradesPerPage;
  const indexOfFirstTrade = indexOfLastTrade - tradesPerPage;
  const currentTrades = trades.slice(indexOfFirstTrade, indexOfLastTrade);

  const getExitReasonLabel = (reason: string) => {
    switch (reason) {
      case 'stop_loss': return 'STOP LOSS';
      case 'trailing_stop': return 'TRAILING STOP';
      case 'take_profit': return 'TAKE PROFIT';
      case 'time_based': return 'MAX DURATION';
      case 'indicator': return 'SIGNAL EXIT';
      case 'end_of_data': return 'END OF DATA';
      default: return reason.toUpperCase();
    }
  };

  return (
    <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg overflow-hidden flex flex-col font-mono text-xs text-[#949494]">
      {/* Table Title */}
      <div className="px-4 py-3 border-b border-[#131316] bg-[#0C0C0E] flex items-center justify-between">
        <span className="font-bold text-[#F5F5F7] uppercase tracking-wider">Executed Trade History</span>
        <span className="text-[10px] text-[#555]">{trades.length} TOTAL POSITIONS</span>
      </div>

      {/* Responsive Table Wrapper */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[#15151A] bg-black/40 text-[10px] text-[#555] uppercase">
              <th className="py-2.5 px-4">Trade ID</th>
              <th className="py-2.5 px-4">Type</th>
              <th className="py-2.5 px-4">Entry Date</th>
              <th className="py-2.5 px-4">Entry Px</th>
              <th className="py-2.5 px-4">Exit Date</th>
              <th className="py-2.5 px-4">Exit Px</th>
              <th className="py-2.5 px-4">Qty</th>
              <th className="py-2.5 px-4 text-right">PnL ($)</th>
              <th className="py-2.5 px-4 text-right">PnL (%)</th>
              <th className="py-2.5 px-4 text-center">Exit Trigger</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#131316]">
            {currentTrades.map((trade) => {
              const isProfit = trade.pnl >= 0;
              const pnlColor = isProfit ? 'text-[#00C805]' : 'text-[#FF3B60]';
              
              return (
                <tr 
                  key={trade.id} 
                  className="hover:bg-black/20 text-[11px] transition-colors border-b border-[#131316] text-[#E5E5E5]"
                >
                  <td className="py-2.5 px-4 font-bold text-[#949494]">{trade.id}</td>
                  <td className="py-2.5 px-4 uppercase text-[#949494]">{trade.type}</td>
                  <td className="py-2.5 px-4 text-[#949494]">{trade.entryDate.replace('T', ' ')}</td>
                  <td className="py-2.5 px-4">${trade.entryPrice.toFixed(2)}</td>
                  <td className="py-2.5 px-4 text-[#949494]">{trade.exitDate.replace('T', ' ')}</td>
                  <td className="py-2.5 px-4">${trade.exitPrice.toFixed(2)}</td>
                  <td className="py-2.5 px-4">{trade.quantity.toLocaleString()}</td>
                  <td className={`py-2.5 px-4 text-right font-bold font-data ${pnlColor}`}>
                    {isProfit ? '+' : ''}${trade.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className={`py-2.5 px-4 text-right font-bold font-data ${pnlColor}`}>
                    {isProfit ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      trade.exitReason === 'stop_loss' 
                        ? 'bg-red-500/10 text-[#FF3B60] border border-red-500/20' 
                        : trade.exitReason === 'take_profit'
                        ? 'bg-green-500/10 text-[#00C805] border border-green-500/20'
                        : trade.exitReason === 'trailing_stop'
                        ? 'bg-amber-500/10 text-terminal-amber border border-amber-500/20'
                        : 'bg-zinc-800 text-[#949494]'
                    }`}>
                      {getExitReasonLabel(trade.exitReason)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-[#131316] bg-black/40 flex items-center justify-between flex-shrink-0">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-2.5 py-1 rounded bg-[#0A0A0C] border border-[#222] hover:bg-[#15151A] hover:text-[#E5E5E5] disabled:opacity-40 disabled:hover:bg-[#0A0A0C] disabled:hover:text-[#949494] transition-all text-[10px]"
          >
            PREV PAGE
          </button>
          
          <span className="text-[10px] text-[#555] uppercase">
            Page {currentPage} of {totalPages}
          </span>

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-2.5 py-1 rounded bg-[#0A0A0C] border border-[#222] hover:bg-[#15151A] hover:text-[#E5E5E5] disabled:opacity-40 disabled:hover:bg-[#0A0A0C] disabled:hover:text-[#949494] transition-all text-[10px]"
          >
            NEXT PAGE
          </button>
        </div>
      )}
    </div>
  );
}
