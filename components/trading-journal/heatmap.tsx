"use client"

import React, { useMemo, useState } from "react"
import { JournalTrade } from "./types"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface HeatmapProps {
  trades: JournalTrade[]
  onSelectDate?: (dateStr: string) => void
}

// Helper to determine US stock market holidays or weekend name
function getHolidayOrWeekendName(date: Date): string | null {
  const y = date.getFullYear()
  const m = date.getMonth() // 0-indexed
  const d = date.getDate()
  const dayOfWeek = date.getDay()
  
  if (dayOfWeek === 0) return "Sunday (Weekend)"
  if (dayOfWeek === 6) return "Saturday (Weekend)"
  
  // New Year's Day (Jan 1)
  if (m === 0 && d === 1) return "New Year's Day"
  
  // Martin Luther King Jr. Day (Third Monday in Jan)
  if (m === 0 && dayOfWeek === 1 && d >= 15 && d <= 21) return "Martin Luther King Jr. Day"
  
  // Presidents' Day (Third Monday in Feb)
  if (m === 1 && dayOfWeek === 1 && d >= 15 && d <= 21) return "Presidents' Day"
  
  // Good Friday
  if (y === 2025 && m === 3 && d === 18) return "Good Friday"
  if (y === 2026 && m === 3 && d === 3) return "Good Friday"
  if (y === 2027 && m === 2 && d === 26) return "Good Friday"
  
  // Memorial Day (Last Monday in May)
  if (m === 4 && dayOfWeek === 1 && d >= 25 && d <= 31) return "Memorial Day"
  
  // Juneteenth (June 19)
  if (m === 5 && d === 19) return "Juneteenth"
  
  // Independence Day (July 4)
  if (m === 6 && d === 4) return "Independence Day"
  
  // Labor Day (First Monday in Sept)
  if (m === 8 && dayOfWeek === 1 && d >= 1 && d <= 7) return "Labor Day"
  
  // Thanksgiving Day (Fourth Thursday in Nov)
  if (m === 10 && dayOfWeek === 4 && d >= 22 && d <= 28) return "Thanksgiving Day"
  
  // Christmas Day (Dec 25)
  if (m === 11 && d === 25) return "Christmas Day"
  
  return null
}

export function Heatmap({ trades, onSelectDate }: HeatmapProps) {
  const [offsetWeeks, setOffsetWeeks] = useState(0)
  const numWeeks = 72 // Fits screens nicely with spacers

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

  // Generate basic weeks grid based on offsetWeeks
  const baseGridData = useMemo(() => {
    const columns: Date[][] = []
    const today = new Date()
    
    // Find Saturday of the current week shifted by offsetWeeks
    const endOfWeek = new Date(today)
    const currentDay = endOfWeek.getDay() // 0 = Sun, 6 = Sat
    endOfWeek.setDate(endOfWeek.getDate() + (6 - currentDay) - (offsetWeeks * 7))
    
    // Start date is numWeeks ago from endOfWeek's Sunday
    const start = new Date(endOfWeek)
    start.setDate(start.getDate() - (numWeeks * 7 - 1))
    
    const currentDate = new Date(start)
    
    for (let w = 0; w < numWeeks; w++) {
      const week: Date[] = []
      for (let d = 0; d < 7; d++) {
        week.push(new Date(currentDate))
        currentDate.setDate(currentDate.getDate() + 1)
      }
      columns.push(week)
    }
    
    return columns
  }, [offsetWeeks])

  // Generate grid with month spacers (2 columns spacer between months)
  const renderedColumns = useMemo(() => {
    const cols: (Date[] | null)[] = []
    let lastMonth = -1
    
    baseGridData.forEach((week) => {
      const wednesday = week[3]
      const currentMonth = wednesday.getMonth()
      
      if (lastMonth !== -1 && currentMonth !== lastMonth) {
        // Add 2 spacer columns between months
        cols.push(null)
        cols.push(null)
      }
      
      cols.push(week)
      lastMonth = currentMonth
    })
    
    return cols
  }, [baseGridData])

  // Total columns = columns of weeks/spacers + 1 column for weekday headers
  const totalCols = renderedColumns.length + 1

  // Helper to determine color tier based on daily PnL
  const getCellClasses = (dateStr: string, pnl: number | undefined) => {
    if (pnl === undefined || pnl === 0) {
      return "bg-[#1E1E24] border-[#2A2A33] hover:bg-[#2C2C38] hover:border-[#555]"
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

    renderedColumns.forEach((week, colIdx) => {
      if (week === null) return // Skip spacers
      
      const wednesday = week[3]
      const currentMonth = wednesday.getMonth()
      
      if (currentMonth !== lastMonth) {
        const monthLabel = wednesday.toLocaleString("en-US", { month: "short" }).toUpperCase()
        headers.push({ label: monthLabel, colIndex: colIdx })
        lastMonth = currentMonth
      }
    })

    // Filter to avoid headers being too close
    return headers.filter((header, index) => {
      if (index === 0) return true
      const prev = headers[index - 1]
      return header.colIndex - prev.colIndex > 2
    })
  }, [renderedColumns])

  return (
    <div className="font-mono text-[9px] select-none flex flex-col gap-3 w-full relative">
      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-[#131316] pb-2 w-full">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold text-[#F5F5F7] uppercase tracking-wider">P&L</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOffsetWeeks(prev => prev + 10)}
              className="p-1 rounded bg-[#0A0A0C] border border-[#1A1A1E] hover:border-[#333] hover:text-white transition-colors"
              title="Go back 10 weeks"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setOffsetWeeks(0)}
              disabled={offsetWeeks === 0}
              className="px-2 py-0.5 rounded bg-[#0A0A0C] border border-[#1A1A1E] hover:border-[#333] text-[8px] font-bold uppercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-white"
            >
              Latest
            </button>
            <button
              onClick={() => setOffsetWeeks(prev => Math.max(0, prev - 10))}
              disabled={offsetWeeks === 0}
              className="p-1 rounded bg-[#0A0A0C] border border-[#1A1A1E] hover:border-[#333] hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Go forward 10 weeks"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[#949494] uppercase text-[8px] font-bold">Loss</span>
          <div className="w-2.5 h-2.5 rounded-sm bg-terminal-red border border-transparent" />
          <div className="w-2.5 h-2.5 rounded-sm bg-[#8C1B2A] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded-sm bg-[#5C1621] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded-sm bg-[#2D0D12] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded-sm bg-[#1E1E24] border border-[#2A2A33]" />
          <div className="w-2.5 h-2.5 rounded-sm bg-[#042813] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded-sm bg-[#084D25] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded-sm bg-[#0C7338] border border-transparent" />
          <div className="w-2.5 h-2.5 rounded-sm bg-terminal-green border border-transparent" />
          <span className="text-[#949494] uppercase text-[8px] font-bold">Profit</span>
        </div>
      </div>

      {/* Grid Container */}
      <div className="w-full flex flex-col gap-1 relative z-20">
        {/* Month Labels */}
        <div 
          className="grid gap-[3px] w-full"
          style={{ gridTemplateColumns: `repeat(${totalCols}, minmax(0, 1fr))` }}
        >
          <div /> {/* column 0 weekday header spacer */}
          {renderedColumns.map((week, wIdx) => {
            if (week === null) {
              return <div key={`month-spacer-${wIdx}`} />
            }
            
            const monthHeader = monthHeaders.find(h => h.colIndex === wIdx)
            return (
              <div key={`month-header-${wIdx}`} className="text-[#949494] font-bold text-[8px] whitespace-nowrap overflow-visible text-left">
                {monthHeader ? monthHeader.label : ""}
              </div>
            )
          })}
        </div>

        {/* Grid Cells Columns */}
        <div 
          className="grid gap-[3px] w-full"
          style={{ gridTemplateColumns: `repeat(${totalCols}, minmax(0, 1fr))` }}
        >
          {/* Column 0: Weekday labels aligned perfectly using aspect-square */}
          <div className="flex flex-col gap-[3px] text-[#444] font-bold text-[8px] text-center pr-1.5 w-full justify-between">
            <div className="w-full aspect-square flex items-center justify-end">SUN</div>
            <div className="w-full aspect-square" />
            <div className="w-full aspect-square flex items-center justify-end">TUE</div>
            <div className="w-full aspect-square" />
            <div className="w-full aspect-square flex items-center justify-end">THU</div>
            <div className="w-full aspect-square" />
            <div className="w-full aspect-square flex items-center justify-end">SAT</div>
          </div>

          {/* Other columns */}
          {renderedColumns.map((week, wIdx) => {
            if (week === null) {
              // Spacer column - empty space between months
              return (
                <div key={`spacer-${wIdx}`} className="flex flex-col gap-[3px] w-full" />
              )
            }
            
            return (
              <div key={`week-${wIdx}`} className="flex flex-col gap-[3px] w-full">
                {week.map((day) => {
                  const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
                  const stat = dailyStats[dateStr]
                  const pnl = stat?.pnl
                  const count = stat?.count || 0
                  
                  const holidayOrWeekend = getHolidayOrWeekendName(day)
                  const isDisabled = holidayOrWeekend !== null && (pnl === undefined || pnl === 0)
                  
                  // Visible solid disabled color: dark charcoal background with a solid slate border
                  const cellColorClass = isDisabled
                    ? "bg-[#0D0D12] border-[#1A1A22] cursor-not-allowed"
                    : getCellClasses(dateStr, pnl)
                    
                  const formattedDate = day.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                  })
                  
                  const tooltipText = pnl !== undefined
                    ? `${formattedDate}: ${pnl >= 0 ? "+" : ""}$${pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${count} trade${count > 1 ? "s" : ""})`
                    : holidayOrWeekend
                    ? `${formattedDate}: ${holidayOrWeekend}`
                    : `${formattedDate}: No trades logged`

                  // Prevent edge tooltips from getting cut off dynamically
                  let tooltipAlignClass = "left-1/2 -translate-x-1/2"
                  if (wIdx < 12) {
                    tooltipAlignClass = "left-0 translate-x-0"
                  } else if (wIdx > renderedColumns.length - 15) {
                    tooltipAlignClass = "right-0 translate-x-0"
                  }

                  return (
                    <div
                      key={dateStr}
                      onClick={() => pnl !== undefined && onSelectDate?.(dateStr)}
                      className={`w-full aspect-square rounded-[1.5px] border cursor-pointer transition-all relative group flex-shrink-0 ${cellColorClass}`}
                    >
                      {/* Hover Tooltip Card - Fixed clipping with z-50 and dynamic alignment */}
                      <div className={`absolute bottom-full mb-2 hidden group-hover:block z-50 bg-[#0A0A0C] border border-[#1A1A1E] text-white px-2 py-1 rounded shadow-xl text-[9px] font-mono whitespace-nowrap pointer-events-none ${tooltipAlignClass}`}>
                        <span className={pnl === undefined ? "text-[#949494]" : pnl > 0 ? "text-terminal-green" : "text-terminal-red"}>
                          {tooltipText}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
