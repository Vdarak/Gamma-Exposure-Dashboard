"use client"

import React from "react"
import { JournalTrade } from "./types"
import { X, Edit2, Trash2, ArrowUpRight, Calendar, Clock, Award } from "lucide-react"

interface TradeDetailProps {
  trade: JournalTrade | null
  isOpen: boolean
  onClose: () => void
  onEdit: (trade: JournalTrade) => void
  onDelete: (id: string) => void
}

export function TradeDetail({ trade, isOpen, onClose, onEdit, onDelete }: TradeDetailProps) {
  if (!isOpen || !trade) return null

  const isProfit = trade.pnl >= 0
  const isOption = trade.tradeType === "Option"
  const isOpenPos = trade.status === "Open"

  // Robinhood green and pinkish-red text/glow styling
  const pnlColorClass = isProfit ? "text-[#00C805]" : "text-[#FF3B60]"
  const pnlBgClass = isProfit ? "bg-[#031A0F] border-[#00C805]/20" : "bg-[#1C080B] border-[#FF3B60]/20"
  
  // Calculate display metrics
  const quantityValue = trade.quantity
  const totalCost = trade.entryPrice * quantityValue
  const marketValue = isOpenPos 
    ? trade.exitPrice * quantityValue // In Open positions, exitPrice stores currentPrice
    : (trade.entryPrice + trade.pnl / quantityValue) * quantityValue // fallback

  const avgCostText = isOption ? `$${trade.entryPrice.toFixed(2)}` : `$${trade.entryPrice.toFixed(2)}`
  const currentPriceText = isOption ? `$${trade.exitPrice.toFixed(2)}` : `$${trade.exitPrice.toFixed(2)}`
  const breakevenPrice = isOption && trade.strike
    ? trade.optionType === "C" ? trade.strike + trade.entryPrice : trade.strike - trade.entryPrice
    : null

  // Date bought and expiration parsing
  const dateBoughtFormatted = trade.tradeDate ? trade.tradeDate.slice(5) : "--"
  const expiryFormatted = isOption && trade.expiration ? trade.expiration.slice(5) : "--"

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex justify-end font-mono">
      {/* Backdrop click to close */}
      <div className="flex-1" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-xl bg-[#0A0A0C] border-l border-[#1A1A1E] h-full flex flex-col text-[#E5E5E5] text-xs">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1A1A1E] px-5 py-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span className={`w-2 h-2 rounded-full ${isProfit ? "bg-[#00C805] animate-pulse" : "bg-[#FF3B60] animate-pulse"}`} />
            <h3 className="font-bold text-sm uppercase tracking-wider text-white">
              {trade.ticker} {trade.tradeType.toUpperCase()}
            </h3>
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
              trade.direction === "Buy" ? "bg-[#00C805]/15 text-[#00C805]" : "bg-[#FF3B60]/15 text-[#FF3B60]"
            }`}>
              {trade.direction === "Buy" ? "LONG" : "SHORT"}
            </span>
            {isOpenPos && (
              <span className="text-[9px] bg-terminal-cyan/15 text-terminal-cyan px-1.5 py-0.5 rounded font-bold">
                OPEN POSITION
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => onEdit(trade)}
              className="text-[#D4D4D4] hover:text-white transition-colors flex items-center gap-1 hover:border-[#333] border border-[#1A1A1E] px-2 py-1 rounded bg-black/35"
              title="Edit Position"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase font-bold">Edit</span>
            </button>
            
            <button
              onClick={() => {
                if (confirm(`Are you sure you want to delete the trade for ${trade.ticker}?`)) {
                  onDelete(trade.id)
                  onClose()
                }
              }}
              className="text-[#FF3B60] hover:text-white hover:bg-[#FF3B60]/10 transition-colors flex items-center gap-1 border border-transparent px-2 py-1 rounded"
              title="Delete Position"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase font-bold">Delete</span>
            </button>
            
            <button onClick={onClose} className="text-[#888] hover:text-white pl-2">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          
          {/* Section: Your Position (Robinhood Details Split-Cards) */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-white tracking-wide uppercase">Your Position</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Left Card: Value and Returns */}
              <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg p-4 flex flex-col justify-between min-h-[160px]">
                <div>
                  <span className="text-[#D4D4D4] text-[9px] uppercase font-bold block mb-0.5">
                    {isOpenPos ? "Market Value" : "Realized Payout"}
                  </span>
                  <div className="text-2xl font-bold font-data text-white">
                    ${isOpenPos ? marketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>

                <div className="space-y-2 border-t border-[#131316] pt-3 mt-3">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[#D4D4D4]">
                      {isOpenPos ? "Current Price" : "Avg Entry Price"}
                    </span>
                    <span className="text-white font-bold">{isOpenPos ? currentPriceText : avgCostText}</span>
                  </div>

                  {isOption && (
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-[#D4D4D4]">Strike Price</span>
                      <span className="text-terminal-cyan font-bold">${trade.strike}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[#D4D4D4]">
                      {isOpenPos ? "Unrealized P&L" : "Realized Return"}
                    </span>
                    <span className={`font-bold font-data flex items-center ${pnlColorClass}`}>
                      {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[#D4D4D4]">Total Return %</span>
                    <span className={`font-bold font-data ${pnlColorClass}`}>
                      {trade.pnl >= 0 ? "+" : ""}{trade.pnlPercent.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Card: Expirations and Spec details */}
              <div className="bg-[#050507] border border-[#1A1A1E] rounded-lg p-4 flex flex-col justify-between min-h-[160px]">
                <div>
                  <span className="text-[#D4D4D4] text-[9px] uppercase font-bold block mb-0.5">
                    {isOption ? "Expiration Date" : "Execution Date"}
                  </span>
                  <div className="text-2xl font-bold text-white">
                    {isOption ? expiryFormatted : dateBoughtFormatted}
                  </div>
                </div>

                <div className="space-y-2 border-t border-[#131316] pt-3 mt-3">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[#D4D4D4]">Average Cost</span>
                    <span className="text-white font-bold">{avgCostText}</span>
                  </div>

                  {isOption && breakevenPrice && (
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-[#D4D4D4]">Breakeven Price</span>
                      <span className="text-white font-bold">${breakevenPrice.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[#D4D4D4]">
                      {isOption ? "Contracts" : "Shares / Quantity"}
                    </span>
                    <span className="text-white font-bold">
                      {isOption ? `+${quantityValue}` : quantityValue}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-[#D4D4D4]">Date Bought</span>
                    <span className="text-white font-bold">{dateBoughtFormatted}</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Quick Specifications */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#0D0D0F] border border-[#1A1A1E] rounded p-3 text-center">
              <span className="text-[9px] text-[#D4D4D4] uppercase font-bold block mb-1">Quality Grade</span>
              <div className="text-lg font-bold text-white flex items-center justify-center gap-1.5">
                <Award className={`w-4 h-4 ${
                  trade.quality === "S" ? "text-terminal-amber" : trade.quality === "A" ? "text-[#00C805]" : "text-terminal-purple"
                }`} />
                <span className={
                  trade.quality === "S" ? "text-terminal-amber" : trade.quality === "A" ? "text-[#00C805]" : "text-terminal-purple"
                }>{trade.quality}</span>
              </div>
            </div>

            <div className="bg-[#0D0D0F] border border-[#1A1A1E] rounded p-3 text-center">
              <span className="text-[9px] text-[#D4D4D4] uppercase font-bold block mb-1">Execution strategy</span>
              <div className="text-[10px] font-bold text-white truncate mt-1.5" title={trade.strategy || "None"}>
                {trade.strategy || "Uncategorized"}
              </div>
            </div>

            <div className="bg-[#0D0D0F] border border-[#1A1A1E] rounded p-3 text-center">
              <span className="text-[9px] text-[#D4D4D4] uppercase font-bold block mb-1">Fees & Commissions</span>
              <div className="text-[10px] font-bold text-terminal-red/80 mt-1.5">
                ${trade.fees ? trade.fees.toLocaleString() : "0.00"}
              </div>
            </div>
          </div>

          {/* Screenshot Render */}
          {trade.screenshot && (
            <div className="border border-[#1A1A1E] rounded-lg overflow-hidden bg-black flex flex-col">
              <div className="border-b border-[#1A1A1E] bg-[#0C0C0E] px-4 py-2 text-[10px] font-bold text-[#D4D4D4] uppercase tracking-wider flex justify-between items-center">
                <span>Position Chart Screenshot</span>
                <span className="text-[8px] text-[#949494]">JPEG</span>
              </div>
              <div className="p-1">
                <a href={trade.screenshot} target="_blank" rel="noopener noreferrer" className="block relative group cursor-zoom-in">
                  <img src={trade.screenshot} alt="Position chart screenshot" className="w-full object-contain max-h-80 rounded" />
                  <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                    <span className="bg-black/90 border border-[#25252E] px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider text-white">
                      Open Image In New Tab
                    </span>
                  </div>
                </a>
              </div>
            </div>
          )}

          {/* Trade Rationale */}
          <div className="border border-[#1A1A1E] bg-[#070708] rounded overflow-hidden flex flex-col">
            <div className="border-b border-[#1A1A1E] bg-[#0C0C0E] px-4 py-2 text-[10px] font-bold text-[#D4D4D4] uppercase tracking-wider">
              Position Rationale & Execution Notes
            </div>
            <div className="p-4 font-sans text-xs text-[#D4D4D4] leading-relaxed whitespace-pre-wrap">
              {trade.rationale || "No rationale captured for this position."}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
