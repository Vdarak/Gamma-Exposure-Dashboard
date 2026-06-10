"use client"

import React, { useState, useMemo } from "react"
import { JournalTrade } from "./types"
import { ChevronLeft, ChevronRight, Plus, Eye, X } from "lucide-react"

const getDayOfWeekFromDateStr = (dateStr: string): number => {
  const parts = dateStr.split("-")
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10) - 1
    const d = parseInt(parts[2], 10)
    return new Date(y, m, d).getDay()
  }
  return 0
}

interface CalendarViewProps {
  trades: JournalTrade[]
  onSelectTrade: (trade: JournalTrade) => void
  onAddTradeForDate: (dateStr: string) => void
  onSelectDate: (dateStr: string) => void
}

export function CalendarView({ trades, onSelectTrade, onAddTradeForDate, onSelectDate }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [expandedDate, setExpandedDate] = useState<string | null>(null)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // Get start day of month and total days in month
  const { daysInMonth, startDayIndex, daysArray } = useMemo(() => {
    const startDay = new Date(year, month, 1).getDay() // 0 = Sun, 6 = Sat
    const totalDays = new Date(year, month + 1, 0).getDate()
    
    const arr: (number | null)[] = []
    
    // Fill previous month padding
    for (let i = 0; i < startDay; i++) {
      arr.push(null)
    }
    
    // Fill current month days
    for (let i = 1; i <= totalDays; i++) {
      arr.push(i)
    }
    
    return {
      daysInMonth: totalDays,
      startDayIndex: startDay,
      daysArray: arr
    }
  }, [year, month])

  // Chunk days into weeks (each week has 7 days)
  const weeks = useMemo(() => {
    const result: (number | null)[][] = []
    for (let i = 0; i < daysArray.length; i += 7) {
      result.push(daysArray.slice(i, i + 7))
    }
    // Pad the last week with nulls to complete 7 days if necessary
    if (result.length > 0) {
      const lastWeek = result[result.length - 1]
      while (lastWeek.length < 7) {
        lastWeek.push(null)
      }
    }
    return result
  }, [daysArray])

  // Group trades by day (1-31) of the current year/month timezone-safely
  const dailyTrades = useMemo(() => {
    const grouped: Record<number, JournalTrade[]> = {}
    
    trades.forEach((trade) => {
      const parts = trade.tradeDate.split("-")
      if (parts.length === 3) {
        const tYear = parseInt(parts[0], 10)
        const tMonth = parseInt(parts[1], 10) - 1
        const tDay = parseInt(parts[2], 10)
        
        if (tYear === year && tMonth === month) {
          if (!grouped[tDay]) {
            grouped[tDay] = []
          }
          grouped[tDay].push(trade)
        }
      }
    })
    
    return grouped
  }, [trades, year, month])

  // Previous Month
  const handlePrevMonth = () => {
    setExpandedDate(null)
    setCurrentDate(new Date(year, month - 1, 1))
  }

  // Next Month
  const handleNextMonth = () => {
    setExpandedDate(null)
    setCurrentDate(new Date(year, month + 1, 1))
  }

  const monthName = currentDate.toLocaleString("en-US", { month: "long" }).toUpperCase()
  const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

  return (
    <div className="flex flex-col gap-4 font-mono text-xs text-[#E5E5E5] select-none h-full">
      {/* Calendar Navigation Header (TradeSync style with + NEW TRADE) */}
      <div className="flex items-center justify-between bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">
            {monthName} {year}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 rounded bg-black border border-[#1A1A1E] hover:border-[#333] hover:text-white transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setExpandedDate(null)
                setCurrentDate(new Date())
              }}
              className="px-2.5 py-1 rounded bg-black border border-[#1A1A1E] hover:border-[#333] hover:text-white text-[9px] font-bold uppercase transition-colors"
            >
              TODAY
            </button>
            <button
              onClick={handleNextMonth}
              className="p-1.5 rounded bg-black border border-[#1A1A1E] hover:border-[#333] hover:text-white transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => onAddTradeForDate(`${year}-${String(month + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`)}
            className="flex items-center gap-1 px-3 py-1.5 bg-[#00C805] text-black border border-[#00C805] hover:bg-[#00C805]/95 rounded text-[9px] font-bold uppercase transition-all"
          >
            <Plus className="w-3 h-3 stroke-[3]" /> NEW TRADE
          </button>
        </div>
      </div>

      {/* Weekday Titles Grid + WEEKLY Header (8 columns) */}
      <div className="grid grid-cols-8 gap-2 text-[#A3A3A3] text-center font-bold text-[10px] tracking-widest border-b border-[#131316] pb-2 flex-shrink-0">
        {WEEKDAYS.map((day) => (
          <div key={day}>{day}</div>
        ))}
        <div>WEEKLY</div>
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-8 gap-2.5 flex-1 overflow-y-auto pr-0.5 terminal-scrollbar min-h-0">
        {weeks.map((week, wIdx) => {
          // Calculate weekly P&L sums
          let weeklyPnl = 0
          let weeklyTrades = 0
          let hasWeeklyTrades = false

          week.forEach(day => {
            if (day !== null) {
              const dayTrades = dailyTrades[day] || []
              weeklyPnl += dayTrades.reduce((sum, t) => sum + t.pnl, 0)
              weeklyTrades += dayTrades.length
              if (dayTrades.length > 0) hasWeeklyTrades = true
            }
          })

          return (
            <React.Fragment key={`week-row-${wIdx}`}>
              {/* Render 7 Days of the Week */}
              {week.map((day, dIdx) => {
                if (day === null) {
                  return (
                    <div
                      key={`empty-${wIdx}-${dIdx}`}
                      className="bg-transparent border border-transparent rounded-lg min-h-[135px]"
                    />
                  )
                }

                const dayTrades = dailyTrades[day] || []
                const dayPnl = dayTrades.reduce((sum, t) => sum + t.pnl, 0)
                const tradeCount = dayTrades.length
                const hasTrades = tradeCount > 0
                const dayScreenshot = dayTrades.find(t => t.screenshot)?.screenshot

                const monthStr = String(month + 1).padStart(2, "0")
                const dayStr = String(day).padStart(2, "0")
                const dateStr = `${year}-${monthStr}-${dayStr}`

                const isExpanded = expandedDate === dateStr

                const cardBorderClass = !hasTrades
                  ? "border-[#1A1A1E] hover:border-[#333]"
                  : dayPnl >= 0
                  ? `border-terminal-green/30 hover:border-terminal-green bg-[#03150D] glow-green ${isExpanded ? "border-terminal-green/80 shadow-md" : ""}`
                  : `border-terminal-red/30 hover:border-terminal-red bg-[#160609] glow-red ${isExpanded ? "border-terminal-red/80 shadow-md" : ""}`

                const pnlColorClass = dayPnl > 0
                  ? "text-terminal-green"
                  : dayPnl < 0
                  ? "text-terminal-red"
                  : "text-[#949494]"

                const tickers = Array.from(new Set(dayTrades.map(t => t.ticker)))

                return (
                  <div
                    key={`day-${day}`}
                    className={`rounded-lg border bg-[#050507] p-2.5 min-h-[135px] flex flex-col justify-between relative group transition-all overflow-hidden ${
                      isExpanded ? "border-white/50" : ""
                    } ${cardBorderClass}`}
                  >
                    {/* Fade screenshot overlay background */}
                    {dayScreenshot && (
                      <div
                        className="absolute inset-0 bg-cover bg-center opacity-25 filter blur-[0.5px] transition-opacity group-hover:opacity-35"
                        style={{ backgroundImage: `url(${dayScreenshot})` }}
                      />
                    )}
                    {dayScreenshot && (
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none" />
                    )}

                    {/* Day Date Marker */}
                    <div className="flex items-center justify-between relative z-10">
                      <span className="text-[14px] font-bold text-white tracking-wide">
                        {day}
                      </span>
                      <span className="text-[8px] text-[#A3A3A3] font-bold">
                        {tradeCount > 0 ? `${tradeCount} TRADES` : ""}
                      </span>
                    </div>

                    {/* Massive PnL Typography */}
                    <div className="my-auto relative z-10 flex justify-center items-center h-12">
                      {hasTrades ? (
                        <span className={`text-[17px] md:text-[20px] font-bold font-data leading-none tracking-tight ${pnlColorClass}`}>
                          {dayPnl >= 0 ? "+" : ""}${dayPnl.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#888] font-bold uppercase tracking-widest">
                          Flat
                        </span>
                      )}
                    </div>

                    {/* Tickers & Hover Controls */}
                    <div className="relative z-10 flex items-center justify-between h-5 overflow-hidden">
                      <div className="flex flex-wrap gap-1 max-w-[70%] group-hover:opacity-0 transition-opacity duration-150 items-center">
                        {Array.from(new Set(dayTrades.map(t => t.quality))).map(q => (
                          <span
                            key={q}
                            className={`text-[8px] px-1.5 rounded font-bold tracking-tight ${
                              q === "S"
                                ? "bg-terminal-amber/15 text-terminal-amber border border-terminal-amber/30"
                                : q === "A"
                                ? "bg-terminal-green/15 text-terminal-green border border-terminal-green/30"
                                : "bg-terminal-purple/15 text-terminal-purple border border-terminal-purple/30"
                            }`}
                          >
                            {q}
                          </span>
                        ))}
                      </div>

                      {/* Hover actions */}
                      <div className={`absolute inset-0 flex items-center justify-between transition-opacity duration-150 bg-transparent ${
                        isExpanded ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}>
                        {hasTrades ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (tradeCount > 1) {
                                setExpandedDate(isExpanded ? null : dateStr)
                              } else {
                                onSelectTrade(dayTrades[0])
                              }
                            }}
                            className={`flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded font-bold uppercase border transition-all ${
                              isExpanded
                                ? "bg-[#00C805] text-black border-[#00C805]"
                                : "bg-black/90 border-[#222] hover:border-white text-[#E5E5E5]"
                            }`}
                            title="Inspect Trades"
                          >
                            <Eye className="w-2.5 h-2.5" /> View
                          </button>
                        ) : (
                          <div />
                        )}
                        
                        <button
                          onClick={() => onAddTradeForDate(dateStr)}
                          className="flex items-center gap-1 text-[8px] bg-terminal-cyan/10 border border-terminal-cyan/25 hover:bg-terminal-cyan hover:text-black text-terminal-cyan px-1.5 py-0.5 rounded font-bold uppercase ml-auto"
                          title="Add Trade"
                        >
                          <Plus className="w-2.5 h-2.5" /> Trade
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Weekly Total Column (8th column) */}
              <div className="rounded-lg border border-[#1A1A1E] bg-[#0A0A0C] p-2.5 min-h-[135px] flex flex-col justify-between">
                <span className="text-[#949494] text-[9px] font-bold uppercase tracking-wider">Weekly P&L</span>
                <div className="my-auto flex flex-col items-center justify-center gap-1">
                  {hasWeeklyTrades ? (
                    <>
                      <span className={`text-[16px] md:text-[18px] font-bold font-data leading-none ${
                        weeklyPnl >= 0 ? "text-terminal-green" : "text-terminal-red"
                      }`}>
                        {weeklyPnl >= 0 ? "+" : ""}${weeklyPnl.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-[8px] text-[#A3A3A3] font-bold">
                        {weeklyTrades} TRADES
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] text-[#444] font-bold uppercase">Flat</span>
                  )}
                </div>
                <div className="h-5" />
              </div>

              {/* Full-width Row Drawer for expanded day in this specific week */}
              {expandedDate && week.some(day => {
                if (day === null) return false
                const monthStr = String(month + 1).padStart(2, "0")
                const dayStr = String(day).padStart(2, "0")
                return `${year}-${monthStr}-${dayStr}` === expandedDate
              }) && (
                <div className="col-span-8 bg-[#070709] border border-[#1A1A1E]/80 rounded-lg p-3.5 my-1.5 animate-slide-down flex flex-col gap-2 shadow-2xl relative">
                  {/* Triangle Connector Pointer pointing to clicked card */}
                  <div 
                    className="absolute -top-2 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[8px] border-b-[#1A1A1E]/80 -translate-x-1/2 transition-all duration-300"
                    style={{ left: `${(getDayOfWeekFromDateStr(expandedDate) + 0.5) * 12.5}%` }}
                  />
                  <div 
                    className="absolute -top-[7px] w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-b-[7px] border-b-[#070709] -translate-x-1/2 transition-all duration-300"
                    style={{ left: `${(getDayOfWeekFromDateStr(expandedDate) + 0.5) * 12.5}%` }}
                  />
                  <div className="flex justify-between items-center border-b border-[#1A1A1E]/60 pb-1.5">
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">
                      Position logs for {expandedDate}
                    </span>
                    <button
                      onClick={() => setExpandedDate(null)}
                      className="text-terminal-red hover:text-terminal-red/80 text-[9px] uppercase font-bold flex items-center gap-1 transition-all"
                    >
                      <span>Close</span>
                      <X className="w-3 h-3 stroke-[2.5]" />
                    </button>
                  </div>
                  
                  {/* Horizontal Scroll list of trade cards */}
                  <div className="flex gap-3 overflow-x-auto py-1 terminal-scrollbar max-w-full">
                    {(dailyTrades[parseInt(expandedDate.split("-")[2])] || []).map((t) => {
                      const strikeLabel = t.tradeType === "Option" && t.strike
                        ? ` $${t.strike}${t.optionType}`
                        : ""
                      return (
                        <div
                          key={t.id}
                          onClick={() => onSelectTrade(t)}
                          className="flex-shrink-0 w-[140px] bg-black border border-[#15151C] hover:border-[#333] rounded-lg p-3 flex flex-col justify-between h-[85px] cursor-pointer relative group/drawer-item overflow-hidden transition-all shadow-md"
                        >
                          {t.screenshot && (
                            <div
                              className="absolute inset-0 bg-cover bg-center opacity-10 filter blur-[0.2px] group-hover/drawer-item:opacity-20 transition-opacity"
                              style={{ backgroundImage: `url(${t.screenshot})` }}
                            />
                          )}
                          <div className="relative z-10 flex flex-col gap-1">
                            <span className="text-[10px] font-bold text-white uppercase truncate">
                              {t.ticker}{strikeLabel}
                            </span>
                            <span className={`text-[12px] font-bold font-data leading-none ${t.pnl >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                              {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                            </span>
                          </div>
                          <div className="relative z-10 flex justify-between items-center mt-1">
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${
                              t.direction === "Buy" ? "bg-terminal-green/10 text-terminal-green" : "bg-terminal-red/10 text-terminal-red"
                            }`}>
                              {t.direction === "Buy" ? "LONG" : "SHORT"}
                            </span>
                            <span className={`text-[8px] font-bold ${
                              t.quality === "S" ? "text-terminal-amber" : t.quality === "A" ? "text-terminal-green" : "text-terminal-purple"
                            }`}>
                              {t.quality} Grade
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
