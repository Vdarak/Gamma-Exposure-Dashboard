"use client"

import React, { useMemo } from "react"
import { JournalTrade } from "./types"

interface HeatmapProps {
  trades: JournalTrade[]
  onSelectDate?: (dateStr: string) => void
}

export function Heatmap({ trades, onSelectDate }: HeatmapProps) {
  // Aggregate trades by date (YYYY-MM-DD)
  const dailyStats = useMemo(() => {
    const stats: Record<string, { pnl: number; count: number }> = {}
    trades.forEach((trade) => {
      const date = trade.tradeDate
      if (!stats[date]) {
        stats[date] = { pnl: 0, count: 0 }
      }
      stats[date].pnl += trade.pnl
      stats[date].count += 1
    })
    return stats
  }, [trades])

  // Generate date grid: 53 columns, 7 rows (Sunday to Saturday)
  const gridData = useMemo(() => {
    const columns: Date[][] = []
    const today = new Date()
    
    // Find the date 364 days ago
    const start = new Date(today)
    start.setDate(today.getDate() - 364)
    
    // Adjust start date to the nearest Sunday to keep weeks aligned
    const dayOfWeek = start.getDay()
    start.setDate(start.getDate() - dayOfWeek)
    
    const currentDate = new Date(start)
    
    // Generate 53 weeks
    for (let w = 0; w < 53; w++) {
      const week: Date[] = []
      for (let d = 0; d < 7; d++) {
        week.push(new Date(currentDate))
        currentDate.setDate(currentDate.getDate() + 1)
      }
      columns.push(week)
    }
    
    return columns
  }, [])

  // Helper to determine color tier based on daily PnL
  const getCellClasses = (dateStr: string, pnl: number | undefined) => {
    if (pnl === undefined || pnl === 0) {
      return "bg-[#0C0C0E] border-[#131316]/50 hover:bg-[#1A1A22] hover:border-[#333]"
    }

    if (pnl > 0) {
      if (pnl < 250) return "bg-[#042813] border-terminal-green/10 hover:border-terminal-green/30 text-emerald-400"
      if (pnl < 1000) return "bg-[#084D25] border-terminal-green/20 hover:border-terminal-green/40 text-emerald-300"
      if (pnl < 2500) return "bg-[#0C7338] border-terminal-green/30 hover:border-terminal-green/50 text-emerald-200"
      return "bg-terminal-green border-terminal-green/40 hover:brightness-110 shadow-[0_0_6px_rgba(0,255,136,0.3)] text-black"
    } else {
      const absPnl = Math.abs(pnl)
      if (absPnl < 250) return "bg-[#2D0D12] border-terminal-red/10 hover:border-terminal-red/30 text-rose-400"
      if (absPnl < 1000) return "bg-[#5C1621] border-terminal-red/20 hover:border-terminal-red/40 text-rose-300"
      if (absPnl < 2500) return "bg-[#8C1B2A] border-terminal-red/30 hover:border-terminal-red/50 text-rose-200"
      return "bg-terminal-red border-terminal-red/40 hover:brightness-110 shadow-[0_0_6px_rgba(255,59,59,0.3)] text-white"
    }
  }

  // Generate month headers based on columns
  const monthHeaders = useMemo(() => {
    const headers: { label: string; colIndex: number }[] = []
    let lastMonth = -1

    gridData.forEach((week, colIdx) => {
      // Look at Wednesday of the week to determine month label placement
      const wednesday = week[3]
      const currentMonth = wednesday.getMonth()
      
      if (currentMonth !== lastMonth) {
        const monthLabel = wednesday.toLocaleString("en-US", { month: "short" }).toUpperCase()
        headers.push({ label: monthLabel, colIndex: colIdx })
        lastMonth = currentMonth
      }
    })

    // Remove headers that are too close to each other
    return headers.filter((header, index) => {
      if (index === 0) return true
      const prev = headers[index - 1]
      return header.colIndex - prev.colIndex > 2
    })
  }, [gridData])

  return (
    <div className="font-mono text-[9px] select-none flex flex-col gap-3 max-w-full overflow-hidden">
      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-[#131316] pb-2">
        <span className="text-lg font-bold text-[#F5F5F7] uppercase tracking-wider">P&L</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[#949494] uppercase">Loss</span>
          <div className="w-2.5 h-2.5 rounded bg-terminal-red border border-transparent" />
          <div className="w-2.5 h-2.5 rounded bg-[#8C1B2A] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded bg-[#5C1621] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded bg-[#2D0D12] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded bg-[#0C0C0E] border border-[#131316]/50" />
          <div className="w-2.5 h-2.5 rounded bg-[#042813] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded bg-[#084D25] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded bg-[#0C7338] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded bg-terminal-green border border-transparent" />
          <span className="text-[#949494] uppercase">Profit</span>
        </div>
      </div>

      {/* Grid Container */}
      <div className="overflow-x-auto terminal-scrollbar pb-2">
        <div className="min-w-[720px] flex flex-col gap-1.5">
          {/* Month Labels */}
          <div className="h-3 relative w-full mb-0.5">
            {monthHeaders.map((header) => (
              <div
                key={`${header.label}-${header.colIndex}`}
                className="absolute text-[#949494] font-bold"
                style={{ left: `${24 + header.colIndex * 13}px` }}
              >
                {header.label}
              </div>
            ))}
          </div>

          {/* Grid Columns */}
          <div className="flex flex-row gap-[3px]">
            {/* Weekday Row Headers */}
            <div className="w-6 flex flex-col justify-between py-[2px] h-[88px] text-[#444] font-bold text-center pr-1.5">
              <span>SUN</span>
              <span>TUE</span>
              <span>THU</span>
              <span>SAT</span>
            </div>

            {/* Grid Cells */}
            <div className="flex flex-row gap-[3px]">
              {gridData.map((week, wIdx) => (
                <div key={`week-${wIdx}`} className="flex flex-col gap-[3px]">
                  {week.map((day) => {
                    const dateStr = day.toISOString().split("T")[0]
                    const stat = dailyStats[dateStr]
                    const pnl = stat?.pnl
                    const count = stat?.count || 0
                    
                    const cellColorClass = getCellClasses(dateStr, pnl)
                    const formattedDate = day.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric"
                    })
                    
                    const tooltipText = pnl !== undefined
                      ? `${formattedDate}: ${pnl >= 0 ? "+" : ""}$${pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${count} trade${count > 1 ? "s" : ""})`
                      : `${formattedDate}: No trades logged`

                    return (
                      <div
                        key={dateStr}
                        onClick={() => pnl !== undefined && onSelectDate?.(dateStr)}
                        className={`w-2.5 h-2.5 rounded-[1.5px] border cursor-pointer transition-all relative group flex-shrink-0 ${cellColorClass}`}
                      >
                        {/* Hover Tooltip Card */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 bg-[#0A0A0C] border border-[#1A1A1E] text-white px-2 py-1 rounded shadow-xl text-[9px] font-mono whitespace-nowrap pointer-events-none">
                          <span className={pnl === undefined ? "text-[#949494]" : pnl > 0 ? "text-terminal-green" : "text-terminal-red"}>
                            {tooltipText}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
