"use client"

import React, { useState, useEffect, useMemo, useCallback } from "react"
import { 
  RefreshCw, 
  TrendingUp, 
  ArrowUpDown, 
  Calendar, 
  DollarSign, 
  Activity,
  AlertCircle,
  HelpCircle
} from "lucide-react"
import dynamic from "next/dynamic"
import { getOptionsNetFlow, NetFlowStrikeData, NetFlowResponse } from "@/lib/backend-api"
import { colors, typography } from "@/lib/design-tokens"

// Dynamically import Plotly to avoid Next.js SSR errors
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false })

interface OptionNetFlowDashboardProps {
  ticker: string
  selectedExpiries?: string[]
}

export function OptionNetFlowDashboard({ ticker, selectedExpiries }: OptionNetFlowDashboardProps) {
  const [data, setData] = useState<NetFlowStrikeData[]>([])
  const [spotPrice, setSpotPrice] = useState<number>(0.0)
  const [source, setSource] = useState<string>("")
  const [selectedDate, setSelectedDate] = useState<string>("")
  const [viewMode, setViewMode] = useState<"contracts" | "premium">("contracts")
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch Net Flow data
  const fetchNetFlow = useCallback(async (t: string, dateStr?: string) => {
    try {
      setIsLoading(true)
      setError(null)
      const res = await getOptionsNetFlow(t, dateStr)
      if (res.success) {
        setData(res.data)
        setSpotPrice(res.spotPrice)
        setSource(res.source)
        setSelectedDate(res.date)
      } else {
        setError(res.message || "Failed to load net flow data.")
        setData([])
      }
    } catch (err) {
      console.error(err)
      setError("Failed to fetch Options Net Flow data. Ensure the Python backend is running.")
      setData([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial load when ticker changes
  useEffect(() => {
    fetchNetFlow(ticker)
  }, [ticker, fetchNetFlow])

  // Filter option net flow data based on selected expiries
  const filteredData = useMemo(() => {
    if (!selectedExpiries || selectedExpiries.length === 0) return data
    return data.filter(item => selectedExpiries.includes(item.expiration))
  }, [data, selectedExpiries])

  // Aggregate flow by strike for the Plotly chart
  // This aggregates calls and puts for each strike
  const aggregatedStrikeData = useMemo(() => {
    const strikeMap: Record<number, { strike: number, callNetContracts: number, putNetContracts: number, callNetPremium: number, putNetPremium: number }> = {}
    
    filteredData.forEach(item => {
      const strike = item.strike
      if (!strikeMap[strike]) {
        strikeMap[strike] = {
          strike,
          callNetContracts: 0,
          putNetContracts: 0,
          callNetPremium: 0,
          putNetPremium: 0
        }
      }
      
      const isCall = item.type === "C"
      const contracts = item.netContracts
      const premium = item.netPremium
      
      if (isCall) {
        strikeMap[strike].callNetContracts += contracts
        strikeMap[strike].callNetPremium += premium
      } else {
        strikeMap[strike].putNetContracts += contracts
        strikeMap[strike].putNetPremium += premium
      }
    })
    
    // Convert to array and sort by strike
    return Object.values(strikeMap).sort((a, b) => a.strike - b.strike)
  }, [filteredData])

  // Top Activity Analysis
  const topActivity = useMemo(() => {
    const sorted = [...filteredData].sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium))
    return sorted.slice(0, 10)
  }, [filteredData])

  // Total summary statistics
  const summaryStats = useMemo(() => {
    let callNetContracts = 0
    let putNetContracts = 0
    let callNetPremium = 0
    let putNetPremium = 0
    let totalVolume = 0

    filteredData.forEach(item => {
      totalVolume += item.volume
      const isCall = item.type === "C"
      if (isCall) {
        callNetContracts += item.netContracts
        callNetPremium += item.netPremium
      } else {
        putNetContracts += item.netContracts
        putNetPremium += item.netPremium
      }
    })

    return {
      callNetContracts,
      putNetContracts,
      callNetPremium,
      putNetPremium,
      totalVolume
    }
  }, [filteredData])

  // Plotly chart parameters
  const chartParams = useMemo(() => {
    if (aggregatedStrikeData.length === 0) return null

    // For visualization, filter strikes within +/- 15% of spot price to avoid chart clutter
    const strikesToShow = aggregatedStrikeData.filter(
      item => item.strike >= spotPrice * 0.85 && item.strike <= spotPrice * 1.15
    )

    const strikePrices = strikesToShow.map(item => item.strike)
    
    // Choose Net Contracts or Net Premium
    const callValues = strikesToShow.map(item => 
      viewMode === "contracts" ? item.callNetContracts : item.callNetPremium
    )
    
    // Negate Puts so buying puts (bearish) goes left and writing puts (bullish) goes right
    const putValuesForPlot = strikesToShow.map(item => {
      const val = viewMode === "contracts" ? item.putNetContracts : item.putNetPremium
      return -val
    })
    
    // Raw Puts Net Flow for tooltips
    const putRawValues = strikesToShow.map(item => 
      viewMode === "contracts" ? item.putNetContracts : item.putNetPremium
    )

    return {
      data: [
        {
          type: "bar",
          x: callValues,
          y: strikePrices,
          orientation: "h",
          name: "Call Net Flow",
          marker: {
            color: callValues.map(val => val >= 0 ? colors.accent.green : colors.accent.red),
            line: { width: 0.5, color: "#111" }
          },
          hoverlabel: {
            bgcolor: "#111111",
            bordercolor: "#1A1A1A",
            font: { family: typography.fontMono, size: 10, color: "#E5E5E5" }
          },
          hovertemplate: `Strike: $%{y}<br>Call Net Flow: %{x:$,.0f}<extra></extra>`
        },
        {
          type: "bar",
          x: putValuesForPlot,
          y: strikePrices,
          orientation: "h",
          name: "Put Net Flow",
          customdata: putRawValues,
          marker: {
            color: putValuesForPlot.map(val => val >= 0 ? colors.accent.green : colors.accent.red),
            line: { width: 0.5, color: "#111" }
          },
          hoverlabel: {
            bgcolor: "#111111",
            bordercolor: "#1A1A1A",
            font: { family: typography.fontMono, size: 10, color: "#E5E5E5" }
          },
          hovertemplate: `Strike: $%{y}<br>Put Net Flow: %{customdata:$,.0f}<extra></extra>`
        }
      ],
      layout: {
        barmode: "group",
        dragmode: "pan",
        autosize: true,
        height: 520,
        showlegend: false, // REMOVE LEGEND
        margin: { l: 70, r: 20, t: 30, b: 50 },
        paper_bgcolor: "#0A0A0A", // Card surface
        plot_bgcolor: "#0A0A0A",
        font: {
          family: typography.fontMono,
          color: colors.text.secondary,
          size: 10
        },
        xaxis: {
          title: viewMode === "contracts" 
            ? "Net Contracts (Bullish → | ← Bearish)" 
            : "Net Premium Flow (Bullish → | ← Bearish)",
          gridcolor: "#1A1A1A",
          zerolinecolor: "#2A2A2A",
          zerolinewidth: 1.5,
          tickfont: { color: colors.text.muted },
          titlefont: { color: colors.text.secondary },
          tickformat: viewMode === "contracts" ? "," : "$,.0f"
        },
        yaxis: {
          title: "Strike Price ($)",
          gridcolor: "#1A1A1A",
          zerolinecolor: "#1A1A1A",
          tickfont: { color: colors.text.muted },
          titlefont: { color: colors.text.secondary },
          tickmode: "linear",
          tick0: 0,
          dtick: Math.max(1.0, Math.round(spotPrice * 0.01))
        },
        shapes: [
          // Current Spot Price Line (Amber #FFB800)
          {
            type: "line",
            xref: "paper",
            yref: "y",
            x0: 0,
            x1: 1,
            y0: spotPrice,
            y1: spotPrice,
            line: {
              color: colors.accent.amber,
              width: 1.5,
              dash: "dashdot"
            }
          }
        ],
        annotations: [
          {
            xref: "paper",
            yref: "y",
            x: 0.95,
            y: spotPrice,
            text: `SPOT ${spotPrice.toFixed(0)}`,
            showarrow: false,
            font: {
              color: colors.accent.amber,
              size: 9,
              family: typography.fontMono
            },
            bgcolor: "#0A0A0A",
            bordercolor: colors.accent.amber,
            borderwidth: 0.5,
            borderpad: 2
          }
        ]
      }
    }
  }, [aggregatedStrikeData, spotPrice, viewMode])

  const formatNotional = (val: number) => {
    const absVal = Math.abs(val)
    const sign = val < 0 ? "-" : ""
    if (absVal >= 1e6) return `${sign}$${(absVal / 1e6).toFixed(2)}M`
    if (absVal >= 1e3) return `${sign}$${(absVal / 1e3).toFixed(1)}K`
    return `${sign}$${absVal.toFixed(0)}`
  }

  const formatContracts = (val: number) => {
    const absVal = Math.abs(val)
    const sign = val < 0 ? "-" : ""
    if (absVal >= 1e3) return `${sign}${(absVal / 1e3).toFixed(1)}K`
    return `${sign}${absVal.toFixed(0)}`
  }

  return (
    <div className="flex flex-col lg:flex-row h-full bg-[#050608] text-[#D1D4DC] font-sans antialiased border border-[#14161C] rounded-lg overflow-y-auto lg:overflow-hidden select-none">
      
      {/* LEFT COLUMN: Main Chart & Config */}
      <div className="flex-1 flex flex-col min-w-0 lg:h-full border-b lg:border-b-0 lg:border-r border-[#14161C]">
        
        {/* HEADER CONTROLS */}
        <div className="flex flex-row items-center justify-between px-5 py-3 border-b border-[#13161C] bg-[#0A0C10] gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold font-mono tracking-tight text-white uppercase flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-[#FFD600]" />
              <span>Net Flow by Strike (EOD)</span>
            </h1>

            {/* View mode toggle */}
            <div className="flex bg-[#0D1015] border border-[#20242D] rounded p-0.5 font-mono text-[10px]">
              <button
                onClick={() => setViewMode("contracts")}
                className={`px-2 py-0.5 rounded transition-all ${
                  viewMode === "contracts"
                    ? 'bg-[#1C202E] text-white font-bold'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Net Contracts
              </button>
              <button
                onClick={() => setViewMode("premium")}
                className={`px-2 py-0.5 rounded transition-all ${
                  viewMode === "premium"
                    ? 'bg-[#1C202E] text-white font-bold'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Net Premium ($)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Source Badge */}
            {source && (
              <span className={`px-2 py-0.5 rounded text-[9px] font-mono border uppercase ${
                source.includes("midpoint") 
                  ? "bg-[#092B1D] text-[#00E676] border-[#00E676]/30"
                  : "bg-[#2A2307] text-[#FFD600] border-[#FFD600]/30"
              }`}>
                {source.includes("midpoint") ? "5m Midpoint Estimation" : "EOD IV/OI Proxy"}
              </span>
            )}

            {/* Date Picker */}
            <div className="flex items-center gap-1 bg-[#0D1015] border border-[#20242D] rounded px-2 h-7 font-mono text-xs">
              <Calendar className="w-3.5 h-3.5 text-gray-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => fetchNetFlow(ticker, e.target.value)}
                className="bg-transparent border-0 text-white focus:outline-none w-[100px] text-[10px]"
              />
            </div>

            <button
              onClick={() => fetchNetFlow(ticker, selectedDate)}
              disabled={isLoading}
              className="flex items-center justify-center w-7 h-7 bg-[#0D1015] border border-[#20242D] rounded hover:bg-[#1C202E] disabled:opacity-50 text-gray-400 hover:text-white"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-white' : ''}`} />
            </button>
          </div>
        </div>

        {/* CHART SECTION */}
        <div className="flex-1 min-h-0 bg-[#020203] relative flex items-center justify-center p-4">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-transparent border-t-[#FFD600] rounded-full animate-spin" />
              <span className="text-xs font-mono text-gray-400">COMPUTING OPTION NET FLOWS...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 text-center max-w-md p-6 border border-red-900/30 bg-red-950/15 rounded">
              <AlertCircle className="w-6 h-6 text-red-500" />
              <span className="text-xs font-mono text-red-200">{error}</span>
            </div>
          ) : chartParams ? (
            <div className="w-full h-full">
              <Plot
                data={chartParams.data as any}
                layout={chartParams.layout as any}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          ) : (
            null
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Statistics Summary & Leaderboard */}
      {data.length > 0 && (
        <div className="w-full lg:w-[320px] bg-[#07090C] flex flex-col lg:h-full justify-between flex-shrink-0">
          
          {/* STATS OVERVIEW CARD */}
          <div className="p-4 border-b border-[#14161C] space-y-4">
            <h2 className="text-[11px] font-bold font-mono tracking-wider text-gray-400 uppercase">
              Net Flow Aggregates
            </h2>

            <div className="grid grid-cols-2 gap-2">
              {/* Call Net Contracts */}
              <div className="bg-[#0A0C10] border border-[#14161C] p-2.5 rounded">
                <span className="text-[9px] font-mono text-gray-500 uppercase block">Calls Net Vol</span>
                <span className={`text-sm font-mono font-bold ${summaryStats.callNetContracts >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
                  {formatContracts(summaryStats.callNetContracts)}
                </span>
              </div>
              {/* Puts Net Contracts */}
              <div className="bg-[#0A0C10] border border-[#14161C] p-2.5 rounded">
                <span className="text-[9px] font-mono text-gray-500 uppercase block">Puts Net Vol</span>
                <span className={`text-sm font-mono font-bold ${summaryStats.putNetContracts >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
                  {formatContracts(summaryStats.putNetContracts)}
                </span>
              </div>
              {/* Call Net Premium */}
              <div className="bg-[#0A0C10] border border-[#14161C] p-2.5 rounded">
                <span className="text-[9px] font-mono text-gray-500 uppercase block">Calls Net Prem</span>
                <span className={`text-sm font-mono font-bold ${summaryStats.callNetPremium >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
                  {formatNotional(summaryStats.callNetPremium)}
                </span>
              </div>
              {/* Put Net Premium */}
              <div className="bg-[#0A0C10] border border-[#14161C] p-2.5 rounded">
                <span className="text-[9px] font-mono text-gray-500 uppercase block">Puts Net Prem</span>
                <span className={`text-sm font-mono font-bold ${summaryStats.putNetPremium >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
                  {formatNotional(summaryStats.putNetPremium)}
                </span>
              </div>
            </div>

            <div className="bg-[#0A0C10] border border-[#14161C] p-3 rounded flex justify-between items-center text-xs font-mono">
              <span className="text-[10px] text-gray-500 uppercase">Total Traded Volume</span>
              <span className="text-white font-bold">{summaryStats.totalVolume.toLocaleString()}</span>
            </div>
          </div>

          {/* LEADERBOARD / TABLE */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-4 py-2 border-b border-[#14161C] bg-[#0A0C10] flex justify-between items-center">
              <span className="text-[10px] font-bold font-mono text-gray-400 uppercase tracking-wider">Top Net Premium Flows</span>
              <span title="Sorted by absolute net option premium added or liquidated.">
                <HelpCircle className="w-3 h-3 text-gray-500 hover:text-white cursor-pointer" />
              </span>
            </div>

            <div className="flex-1 overflow-y-auto font-mono text-[10px]">
              {topActivity.length > 0 && (
                <div className="divide-y divide-[#13151B]">
                  {topActivity.map((item, idx) => {
                    const isCall = item.type === "C"
                    const isBuy = item.netPremium >= 0
                    
                    return (
                      <div key={idx} className="p-3 flex flex-row items-center justify-between hover:bg-[#0A0C10] transition-colors">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-white font-bold">
                            ${item.strike.toFixed(1)} {isCall ? "Call" : "Put"}
                          </span>
                          <span className="text-[8px] text-gray-500">Exp: {item.expiration}</span>
                        </div>
                        
                        <div className="text-right flex flex-col gap-0.5">
                          <span className={`font-bold ${isBuy ? "text-[#00C805]" : "text-[#FF3B60]"}`}>
                            {isBuy ? "BUY" : "SELL"} {formatNotional(item.netPremium)}
                          </span>
                          <span className="text-[8px] text-gray-500">
                            {formatContracts(item.netContracts)} contracts | OI: {item.openInterest.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
