"use client"

import React, { useState, useMemo } from "react"
import { JournalTrade } from "./types"
import { ChevronLeft, ChevronRight, Plus, Eye } from "lucide-react"

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

  // Group trades by day (1-31) of the current year/month
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
    setCurrentDate(new Date(year, month - 1, 1))
  }

  // Next Month
  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
  }

  const monthName = currentDate.toLocaleString("en-US", { month: "long" }).toUpperCase()

  const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

  return (
    <div className="flex flex-col gap-4 font-mono text-xs text-[#E5E5E5] select-none h-full">
      {/* Calendar Navigation Header */}
      <div className="flex items-center justify-between bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-terminal-cyan" />
          <h2 className="text-sm font-bold uppercase tracking-wider">
            {monthName} {year}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevMonth}
            className="p-1.5 rounded bg-black border border-[#1A1A1E] hover:border-[#333] hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentDate(new Date())}
            className="px-3 py-1 rounded bg-black border border-[#1A1A1E] hover:border-[#333] hover:text-white text-[10px] font-bold uppercase transition-colors"
          >
            TODAY
          </button>
          <button
            onClick={handleNextMonth}
            className="p-1.5 rounded bg-black border border-[#1A1A1E] hover:border-[#333] hover:text-white transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Weekday Titles Grid */}
      <div className="grid grid-cols-7 gap-2 text-[#A3A3A3] text-center font-bold text-[10px] tracking-widest border-b border-[#131316] pb-2 flex-shrink-0">
        {WEEKDAYS.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-2.5 flex-1 overflow-y-auto pr-0.5 terminal-scrollbar min-h-0">
        {daysArray.map((day, idx) => {
          if (day === null) {
            // Padding cells representing adjacent months
            return (
              <div
                key={`empty-${idx}`}
                className="bg-transparent border border-transparent rounded-lg min-h-[120px]"
              />
            )
          }

          const dayTrades = dailyTrades[day] || []
          const dayPnl = dayTrades.reduce((sum, t) => sum + t.pnl, 0)
          const tradeCount = dayTrades.length
          const hasTrades = tradeCount > 0
          
          // Find if any trade on this day has a screenshot to display as texture
          const dayScreenshot = dayTrades.find(t => t.screenshot)?.screenshot

          // Format date string for adding/viewing
          const monthStr = String(month + 1).padStart(2, "0")
          const dayStr = String(day).padStart(2, "0")
          const dateStr = `${year}-${monthStr}-${dayStr}`

          // Determine card style states
          const isExpanded = expandedDate === dateStr

          // Determine card style states
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

          // Tickers traded on this day
          const tickers = Array.from(new Set(dayTrades.map(t => t.ticker)))

          return (
            <div
              key={`day-${day}`}
              className={`rounded-lg border bg-[#050507] p-2.5 flex flex-col justify-between relative group transition-all overflow-hidden ${
                isExpanded ? "min-h-[220px] h-auto" : "min-h-[135px]"
              } ${cardBorderClass}`}
            >
              {/* Fade screenshot overlay background */}
              {dayScreenshot && (
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-25 filter blur-[0.5px] transition-opacity group-hover:opacity-35"
                  style={{ backgroundImage: `url(${dayScreenshot})` }}
                />
              )}
              {/* Overlay gradient to keep elements legible */}
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
                {/* Ticker and Quality Badges */}
                <div className="flex flex-wrap gap-1 max-w-[70%] group-hover:opacity-0 transition-opacity duration-150 items-center">
                  {tickers.slice(0, 2).map(ticker => (
                    <span
                      key={ticker}
                      className="bg-black/80 border border-[#222] text-[#D4D4D4] text-[8px] px-1 rounded font-bold tracking-tight uppercase"
                    >
                      {ticker}
                    </span>
                  ))}
                  {tickers.length > 2 && (
                    <span className="text-[8px] text-[#888] font-bold mr-1">
                      +{tickers.length - 2}
                    </span>
                  )}
                  {/* S, A, B Quality Badges */}
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
                <div className="absolute inset-0 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-transparent">
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
                      className="flex items-center gap-1 text-[8px] bg-black/90 border border-[#222] hover:border-white text-[#E5E5E5] px-1.5 py-0.5 rounded font-bold uppercase"
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

              {/* Horizontal scroll list of trades when expanded */}
              {isExpanded && dayTrades.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-[#1A1A1E] w-full relative z-20 animate-fade-in flex flex-col gap-1">
                  <div className="flex gap-1.5 overflow-x-auto pb-1 terminal-scrollbar max-w-full">
                    {dayTrades.map((t) => {
                      const strikeLabel = t.tradeType === "Option" && t.strike
                        ? ` $${t.strike}${t.optionType}`
                        : ""
                      return (
                        <div
                          key={t.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectTrade(t)
                          }}
                          className="flex-shrink-0 w-[78px] bg-black border border-[#15151C] hover:border-[#333] rounded p-1 flex flex-col justify-between h-14 cursor-pointer relative group/item overflow-hidden"
                        >
                          {t.screenshot && (
                            <div
                              className="absolute inset-0 bg-cover bg-center opacity-15 filter blur-[0.2px] group-hover/item:opacity-25 transition-opacity"
                              style={{ backgroundImage: `url(${t.screenshot})` }}
                            />
                          )}
                          <div className="relative z-10 flex flex-col gap-0.5">
                            <span className="text-[7px] font-bold text-white uppercase truncate">
                              {t.ticker}{strikeLabel}
                            </span>
                            <span className={`text-[8px] font-bold font-data leading-none ${t.pnl >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                              {t.pnl >= 0 ? "+" : ""}${Math.round(t.pnl)}
                            </span>
                          </div>
                          <span className={`text-[6px] font-bold px-1 py-0.2 rounded self-start ${
                            t.direction === "Buy" ? "bg-terminal-green/10 text-terminal-green" : "bg-terminal-red/10 text-terminal-red"
                          } relative z-10`}>
                            {t.direction === "Buy" ? "BUY" : "SELL"}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
