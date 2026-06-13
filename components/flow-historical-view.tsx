"use client"

import React, { useEffect, useState, useRef, useMemo } from "react"
import * as d3 from "d3"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { typography } from "@/lib/design-tokens"
import { RefreshCw } from "lucide-react"
import { BACKEND_URL } from "@/lib/backend-api"
import { Slider } from "@/components/ui/slider"

interface FlowHistoricalViewProps {
  ticker: string
  currentTimestamp?: string | null
  onCheckpointChange?: (timestamp: string | null, isLive: boolean) => void
  isLive?: boolean
  setIsLive?: (live: boolean) => void
}

interface IntradaySnapshot {
  timestamp: string
  spotPrice: number
  strikes: {
    [strike: string]: {
      gex: number
      volume: number
      openInterest: number
    }
  }
}

interface HistoricalPoint {
  timestamp: string
  spotPrice: number
  totalGex: number
}

function formatBillions(num: number): string {
  const val = Math.abs(num)
  if (val >= 1e9) return `${num >= 0 ? "+" : "−"}${(val / 1e9).toFixed(1)}B`
  if (val >= 1e6) return `${num >= 0 ? "+" : "−"}${(val / 1e6).toFixed(1)}M`
  return `${num >= 0 ? "+" : "−"}${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function FlowHistoricalView({
  ticker,
  currentTimestamp,
  onCheckpointChange,
  isLive,
  setIsLive,
}: FlowHistoricalViewProps) {
  const leftSvgRef = useRef<SVGSVGElement>(null)
  const rightSvgRef = useRef<SVGSVGElement>(null)
  const leftContainerRef = useRef<HTMLDivElement>(null)
  const rightContainerRef = useRef<HTMLDivElement>(null)

  const [selectedDate, setSelectedDate] = useState<string>("")
  const [intradayData, setIntradayData] = useState<IntradaySnapshot[]>([])
  const [historicalData, setHistoricalData] = useState<HistoricalPoint[]>([])
  
  const [loadingIntraday, setLoadingIntraday] = useState(false)
  const [loadingHistorical, setLoadingHistorical] = useState(false)

  const [dimensions, setDimensions] = useState({ width: 500, height: 350 })

  // Listen for resize
  useEffect(() => {
    if (!leftContainerRef.current) return
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect
        setDimensions({
          width: Math.max(width, 350),
          height: 350
        })
      }
    })
    resizeObserver.observe(leftContainerRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  // Fetch 30-day closing trends on mount / ticker change
  useEffect(() => {
    let active = true
    setLoadingHistorical(true)
    fetch(`${BACKEND_URL}/api/historical-gex?ticker=${ticker}`)
      .then(res => res.json())
      .then(res => {
        if (!active) return
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          setHistoricalData(res.data)
          // Default selected date is the latest date in the history
          const latestDate = res.data[res.data.length - 1].timestamp.split("T")[0]
          setSelectedDate(latestDate)
        } else {
          setHistoricalData([])
          // fallback to today if empty
          const todayNY = new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
          setSelectedDate(new Date(todayNY).toISOString().split("T")[0])
        }
      })
      .catch(err => {
        console.error("Failed to load historical GEX trend:", err)
      })
      .finally(() => {
        if (active) setLoadingHistorical(false)
      })

    return () => { active = false }
  }, [ticker])

  // Fetch Intraday GEX Flow when selectedDate or ticker changes
  useEffect(() => {
    if (!selectedDate) return
    let active = true
    setLoadingIntraday(true)
    
    fetch(`${BACKEND_URL}/api/gex-flow?ticker=${ticker}&date=${selectedDate}`)
      .then(res => res.json())
      .then(res => {
        if (!active) return
        if (res.success && Array.isArray(res.data)) {
          setIntradayData(res.data)
        } else {
          setIntradayData([])
        }
      })
      .catch(err => {
        console.error("Failed to load intraday GEX flow:", err)
      })
      .finally(() => {
        if (active) setLoadingIntraday(false)
      })

    return () => { active = false }
  }, [ticker, selectedDate])

  // Process Intraday Data to select 12 nearest strikes around opening spot
  const { intradaySeries, keyStrikes } = useMemo(() => {
    if (intradayData.length === 0) return { intradaySeries: [], keyStrikes: [] }

    // Use the opening spot (first snapshot of the day)
    const openingSpot = intradayData[0].spotPrice
    
    // Get all unique strikes
    const uniqueStrikes = Array.from(new Set(
      intradayData.flatMap(snap => Object.keys(snap.strikes).map(Number))
    )).sort((a, b) => a - b)

    if (uniqueStrikes.length === 0) return { intradaySeries: [], keyStrikes: [] }

    // Find the strike closest to opening spot
    let closestIdx = 0
    let minDiff = Infinity
    uniqueStrikes.forEach((stk, idx) => {
      const diff = Math.abs(stk - openingSpot)
      if (diff < minDiff) {
        minDiff = diff
        closestIdx = idx
      }
    })

    // Slice 6 below and 6 above (total 12)
    const startIdx = Math.max(0, closestIdx - 6)
    const endIdx = Math.min(uniqueStrikes.length, closestIdx + 6)
    const selectedStrikes = uniqueStrikes.slice(startIdx, endIdx)

    // Build timeline for each selected strike
    const series = selectedStrikes.map(strike => {
      const points = intradayData.map(snap => {
        const item = snap.strikes[strike.toString()]
        return {
          timestamp: new Date(snap.timestamp),
          gex: item ? item.gex : 0,
          spotPrice: snap.spotPrice
        }
      })
      return {
        strike,
        points
      }
    })

    return { intradaySeries: series, keyStrikes: selectedStrikes }
  }, [intradayData])

  // Color palette for the 12 strikes (TradingView-like gradients / distinct colors)
  const strikeColors = useMemo(() => {
    // Generate a spectrum from purples to blues to oranges
    const baseColors = [
      "#FF5733", "#FF8D1A", "#FFC300", "#D1F2A5", "#9FF781", "#33FFBD",
      "#33CCFF", "#3357FF", "#8D33FF", "#E333FF", "#FF33B5", "#FF3333"
    ]
    return d3.scaleOrdinal<number, string>()
      .domain(keyStrikes)
      .range(baseColors.slice(0, Math.max(1, keyStrikes.length)))
  }, [keyStrikes])

  // Render Left Chart (Intraday GEX Flow)
  useEffect(() => {
    if (!leftSvgRef.current || intradayData.length === 0 || intradaySeries.length === 0) return

    const svg = d3.select(leftSvgRef.current)
    svg.selectAll("*").remove()

    const margin = { top: 20, right: 35, bottom: 40, left: 55 }
    const width = dimensions.width - margin.left - margin.right
    const height = dimensions.height - margin.top - margin.bottom

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`)

    // Scales
    const xDomain = d3.extent(intradayData.map(d => new Date(d.timestamp))) as [Date, Date]
    const xScale = d3.scaleTime().domain(xDomain).range([0, width])

    const allGexValues = intradaySeries.flatMap(s => s.points.map(p => p.gex))
    const yDomain = d3.extent(allGexValues) as [number, number]
    // Add 10% padding to Y domain
    const yPad = (yDomain[1] - yDomain[0]) * 0.1 || 1
    const yScale = d3.scaleLinear().domain([yDomain[0] - yPad, yDomain[1] + yPad]).range([height, 0])

    // Gridlines
    g.append("g")
      .attr("class", "grid-y")
      .style("stroke-opacity", 0.1)
      .style("stroke-dasharray", "3,3")
      .call(d3.axisLeft(yScale).ticks(6).tickSize(-width).tickFormat(() => ""))
      .selectAll("line")
      .attr("stroke", "#5E5E62")

    // Draw line generator
    const lineGen = d3.line<{ timestamp: Date; gex: number }>()
      .x(d => xScale(d.timestamp))
      .y(d => yScale(d.gex))
      .curve(d3.curveMonotoneX)

    // Draw lines
    intradaySeries.forEach(s => {
      g.append("path")
        .datum(s.points)
        .attr("fill", "none")
        .attr("stroke", strikeColors(s.strike))
        .attr("stroke-width", 1.5)
        .attr("d", lineGen)
        .style("opacity", 0.8)
    })

    // Current Seek Time Line Indicator
    if (currentTimestamp) {
      const seekDate = new Date(currentTimestamp)
      if (seekDate >= xDomain[0] && seekDate <= xDomain[1]) {
        const seekX = xScale(seekDate)
        
        // Draw vertical line
        g.append("line")
          .attr("x1", seekX)
          .attr("x2", seekX)
          .attr("y1", 0)
          .attr("y2", height)
          .attr("stroke", "#FF00AA") // bright vibrant pink
          .attr("stroke-width", 2)
          .style("stroke-opacity", 0.85)
          
        // Add a badge/label at the top
        g.append("text")
          .attr("x", seekX + 5)
          .attr("y", 12)
          .attr("fill", "#FF00AA")
          .style("font-family", typography.fontMono)
          .style("font-size", "9px")
          .style("font-weight", "bold")
          .text(seekDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }))
      }
    }

    // X Axis
    const xAxis = d3.axisBottom(xScale)
      .ticks(Math.max(2, Math.floor(width / 80)))
      .tickFormat(d => {
        return (d as Date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
      })
    
    const xAxisG = g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis)
    xAxisG.selectAll("line").attr("stroke", "#1A1A1A")
    xAxisG.selectAll("path").attr("stroke", "#1A1A1A")
    xAxisG.selectAll("text")
      .attr("fill", "#8E8E93")
      .style("font-family", typography.fontMono)
      .style("font-size", "9px")
      .attr("dy", "10px")

    // Y Axis
    const yAxis = d3.axisLeft(yScale)
      .ticks(6)
      .tickFormat(d => formatBillions(d as number))
    
    const yAxisG = g.append("g")
      .call(yAxis)
    yAxisG.selectAll("line").attr("stroke", "none")
    yAxisG.selectAll("path").attr("stroke", "none")
    yAxisG.selectAll("text")
      .attr("fill", "#8E8E93")
      .style("font-family", typography.fontMono)
      .style("font-size", "9px")
      .attr("dx", "-5px")

    // Interactive Crosshair overlay
    const overlay = g.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "transparent")

    const hoverLine = g.append("line")
      .attr("y1", 0)
      .attr("y2", height)
      .attr("stroke", "#3A3A3C")
      .attr("stroke-width", 1)
      .style("stroke-dasharray", "4,4")
      .style("opacity", 0)

    const tooltipEl = d3.select("#intraday-tooltip")

    overlay.on("mousemove", function(event) {
      const [mx] = d3.pointer(event)
      const xDate = xScale.invert(mx)
      
      // Find closest snapshot
      const bisect = d3.bisector((d: IntradaySnapshot) => new Date(d.timestamp)).left
      const idx = bisect(intradayData, xDate)
      
      const snap = intradayData[idx] || intradayData[idx - 1]
      if (snap) {
        const cx = xScale(new Date(snap.timestamp))
        hoverLine.attr("x1", cx).attr("x2", cx).style("opacity", 1)

        // Find strikes and GEX at this point
        const spot = snap.spotPrice
        const timeStr = new Date(snap.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
        
        let htmlStr = `
          <div class="text-[11px] text-gray-400 font-mono mb-1 font-semibold">${timeStr} | Spot: $${spot.toFixed(2)}</div>
          <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 max-h-[150px] overflow-y-auto pr-1">
        `

        // Sort selected strikes descending by GEX
        const rowData = keyStrikes.map(stk => {
          const item = snap.strikes[stk.toString()]
          return {
            strike: stk,
            gex: item ? item.gex : 0
          }
        }).sort((a, b) => b.gex - a.gex)

        rowData.forEach(r => {
          const col = strikeColors(r.strike)
          htmlStr += `
            <div class="flex items-center text-[10px] font-mono">
              <span class="w-1.5 h-1.5 rounded-full mr-1" style="background-color: ${col}"></span>
              <span class="text-gray-300 font-semibold">$${r.strike}</span>
            </div>
            <div class="text-[10px] font-mono text-right ${r.gex >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"}">
              ${formatBillions(r.gex)}
            </div>
          `
        })

        htmlStr += `</div>`

        tooltipEl.style("opacity", 1)
          .html(htmlStr)
          // Position tooltip to avoid screen edges
          const rect = leftContainerRef.current?.getBoundingClientRect()
          const tipX = event.clientX - (rect?.left || 0) + 15
          const tipY = event.clientY - (rect?.top || 0) - 20
          tooltipEl.style("left", `${Math.min(tipX, dimensions.width - 160)}px`)
            .style("top", `${Math.max(10, tipY)}px`)
      }
    })

    overlay.on("mouseleave", () => {
      hoverLine.style("opacity", 0)
      tooltipEl.style("opacity", 0)
    })

  }, [dimensions, intradayData, intradaySeries, keyStrikes, strikeColors, currentTimestamp])

  // Render Right Chart (30-Day Historical GEX Trend)
  useEffect(() => {
    if (!rightSvgRef.current || historicalData.length === 0) return

    const svg = d3.select(rightSvgRef.current)
    svg.selectAll("*").remove()

    const margin = { top: 20, right: 45, bottom: 40, left: 45 }
    const width = dimensions.width - margin.left - margin.right
    const height = dimensions.height - margin.top - margin.bottom

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`)

    // Scales
    const xScale = d3.scaleBand()
      .domain(historicalData.map(d => d.timestamp.split("T")[0]))
      .range([0, width])
      .padding(0.3)

    const maxGex = d3.max(historicalData.map(d => Math.abs(d.totalGex))) || 1e9
    const yGexScale = d3.scaleLinear()
      .domain([-maxGex * 1.1, maxGex * 1.1])
      .range([height, 0])

    const spotExtent = d3.extent(historicalData.map(d => d.spotPrice)) as [number, number]
    const spotPad = (spotExtent[1] - spotExtent[0]) * 0.15 || 50
    const ySpotScale = d3.scaleLinear()
      .domain([spotExtent[0] - spotPad, spotExtent[1] + spotPad])
      .range([height, 0])

    // Gridlines for Y GEX scale
    g.append("g")
      .attr("class", "grid-y")
      .style("stroke-opacity", 0.08)
      .call(d3.axisLeft(yGexScale).ticks(6).tickSize(-width).tickFormat(() => ""))
      .selectAll("line")
      .attr("stroke", "#5E5E62")

    // Draw zero GEX line
    g.append("line")
      .attr("x1", 0)
      .attr("x2", width)
      .attr("y1", yGexScale(0))
      .attr("y2", yGexScale(0))
      .attr("stroke", "#2C2C35")
      .attr("stroke-width", 1)

    // Render bars (GEX)
    historicalData.forEach(d => {
      const dStr = d.timestamp.split("T")[0]
      const x = xScale(dStr)!
      const yZero = yGexScale(0)
      const yVal = yGexScale(d.totalGex)
      const isSelected = dStr === selectedDate

      const isUp = d.totalGex >= 0
      const baseCol = isUp ? "rgba(0, 200, 5, 0.5)" : "rgba(255, 59, 96, 0.5)"
      const borderCol = isUp ? "#00C805" : "#FF3B60"

      // Bar container
      g.append("rect")
        .attr("class", "hist-bar cursor-pointer")
        .attr("x", x)
        .attr("y", isUp ? yVal : yZero)
        .attr("width", xScale.bandwidth())
        .attr("height", Math.max(1, Math.abs(yVal - yZero)))
        .attr("fill", isSelected ? borderCol : baseCol)
        .attr("stroke", borderCol)
        .attr("stroke-width", isSelected ? 1.5 : 0.8)
        .attr("rx", 1)
        .on("click", () => {
          setSelectedDate(dStr)
        })
    })

    // Render line (Spot Price)
    const lineGen = d3.line<HistoricalPoint>()
      .x(d => xScale(d.timestamp.split("T")[0])! + xScale.bandwidth() / 2)
      .y(d => ySpotScale(d.spotPrice))
      .curve(d3.curveMonotoneX)

    g.append("path")
      .datum(historicalData)
      .attr("fill", "none")
      .attr("stroke", "#FF9F0A") // Premium orange
      .attr("stroke-width", 1.8)
      .attr("d", lineGen)
      .style("pointer-events", "none")

    // Render dots on Spot Price line
    historicalData.forEach(d => {
      const dStr = d.timestamp.split("T")[0]
      const cx = xScale(dStr)! + xScale.bandwidth() / 2
      const cy = ySpotScale(d.spotPrice)

      g.append("circle")
        .attr("cx", cx)
        .attr("cy", cy)
        .attr("r", dStr === selectedDate ? 4 : 2)
        .attr("fill", "#FF9F0A")
        .attr("stroke", "#0E0E12")
        .attr("stroke-width", 1)
        .style("pointer-events", "none")
    })

    // X Axis
    const tickFilter = (_: string, i: number) => {
      const total = historicalData.length
      if (total <= 10) return true
      const interval = Math.ceil(total / 6)
      return i % interval === 0 || i === total - 1
    }

    const xAxis = d3.axisBottom(xScale)
      .tickValues(xScale.domain().filter(tickFilter))
      .tickFormat(d => {
        // format YYYY-MM-DD to "Jun 12"
        const date = new Date(d)
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })
      })

    const xAxisG = g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis)
    xAxisG.selectAll("line").attr("stroke", "#1A1A1A")
    xAxisG.selectAll("path").attr("stroke", "#1A1A1A")
    xAxisG.selectAll("text")
      .attr("fill", "#8E8E93")
      .style("font-family", typography.fontMono)
      .style("font-size", "9px")
      .attr("dy", "10px")

    // Left Y Axis (GEX)
    const yAxisLeft = d3.axisLeft(yGexScale).ticks(5).tickFormat(d => formatBillions(d as number))
    const yAxisLeftG = g.append("g").call(yAxisLeft)
    yAxisLeftG.selectAll("line").attr("stroke", "none")
    yAxisLeftG.selectAll("path").attr("stroke", "none")
    yAxisLeftG.selectAll("text")
      .attr("fill", "#8E8E93")
      .style("font-family", typography.fontMono)
      .style("font-size", "9px")
      .attr("dx", "-5px")

    // Right Y Axis (Spot Price)
    const yAxisRight = d3.axisRight(ySpotScale).ticks(5).tickFormat(d => `$${(d as number).toFixed(0)}`)
    const yAxisRightG = g.append("g").attr("transform", `translate(${width},0)`).call(yAxisRight)
    yAxisRightG.selectAll("line").attr("stroke", "none")
    yAxisRightG.selectAll("path").attr("stroke", "none")
    yAxisRightG.selectAll("text")
      .attr("fill", "#FF9F0A")
      .style("font-family", typography.fontMono)
      .style("font-size", "9px")
      .attr("dx", "5px")

    // Interactive hover overlay
    const overlay = g.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "transparent")

    const tooltipEl = d3.select("#historical-tooltip")

    overlay.on("mousemove", function(event) {
      const [mx] = d3.pointer(event)
      const eachBand = xScale.step()
      const index = Math.floor(mx / eachBand)
      const d = historicalData[index]
      
      if (d) {
        const dStr = d.timestamp.split("T")[0]
        const dateLabel = new Date(d.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })
        
        tooltipEl.style("opacity", 1)
          .html(`
            <div class="text-[11px] text-gray-400 font-mono mb-1 font-semibold">${dateLabel}</div>
            <div class="flex items-center justify-between gap-4 text-[10px] font-mono mb-0.5">
              <span class="text-gray-400">0DTE GEX:</span>
              <span class="${d.totalGex >= 0 ? "text-[#00C805]" : "text-[#FF3B60]"} font-bold">${formatBillions(d.totalGex)}</span>
            </div>
            <div class="flex items-center justify-between gap-4 text-[10px] font-mono">
              <span class="text-gray-400">Spot Price:</span>
              <span class="text-[#FF9F0A] font-bold">$${d.spotPrice.toFixed(2)}</span>
            </div>
          `)
          
          const rect = rightContainerRef.current?.getBoundingClientRect()
          const tipX = event.clientX - (rect?.left || 0) + 15
          const tipY = event.clientY - (rect?.top || 0) - 20
          tooltipEl.style("left", `${Math.min(tipX, dimensions.width - 150)}px`)
            .style("top", `${Math.max(10, tipY)}px`)
      }
    })

    overlay.on("mouseleave", () => {
      tooltipEl.style("opacity", 0)
    })

    overlay.on("click", function(event) {
      const [mx] = d3.pointer(event)
      const eachBand = xScale.step()
      const index = Math.floor(mx / eachBand)
      const d = historicalData[index]
      if (d) {
        const dStr = d.timestamp.split("T")[0]
        setSelectedDate(dStr)
      }
    })

  }, [dimensions, historicalData, selectedDate])

  const selectedDateLabel = useMemo(() => {
    if (!selectedDate) return ""
    try {
      const date = new Date(selectedDate + "T00:00:00")
      return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    } catch {
      return selectedDate
    }
  }, [selectedDate])

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
      {/* LEFT CARD: Intraday 0DTE GEX Flow */}
      <Card className="bg-[#0E0E12] border-[#1C1C24]">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div className="flex flex-col space-y-1">
            <CardTitle className="text-white text-sm font-semibold flex items-center gap-2">
              {ticker} | 0DTE GEX Flow
              {loadingIntraday && <RefreshCw className="h-3.5 w-3.5 text-gray-500 animate-spin" />}
            </CardTitle>
            <CardDescription className="text-gray-500 text-xs">
              Intraday GEX progression for nearest 12 strikes around open on <span className="text-white font-medium">{selectedDateLabel}</span>
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0 relative flex flex-col" ref={leftContainerRef}>
          {intradayData.length === 0 && !loadingIntraday ? (
            <div className="h-[350px] flex items-center justify-center text-xs text-gray-500 font-mono">
              No intraday checkpoints available for {selectedDateLabel}
            </div>
          ) : (
            <>
              <svg ref={leftSvgRef} width="100%" height={350} className="block overflow-visible" />
              
              {/* Playback Timer Slider just below the chart plotting area */}
              {intradayData.length > 0 && currentTimestamp !== undefined && onCheckpointChange && (
                <div 
                  className="pb-4 pt-1 flex flex-col gap-1.5 select-none"
                  style={{
                    paddingLeft: "55px",
                    paddingRight: "35px"
                  }}
                >
                  <div className="flex items-center justify-between text-[9px] font-mono text-gray-500 mb-0.5">
                    <span>9:30 AM (Open)</span>
                    <span className="text-[#FF00AA] font-bold">
                      SEEK TIME: {(() => {
                        if (!currentTimestamp) return "--"
                        const date = new Date(currentTimestamp)
                        return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
                      })()}
                    </span>
                    <span>4:00 PM (Close)</span>
                  </div>
                  <Slider
                    min={0}
                    max={intradayData.length - 1}
                    step={1}
                    value={[(() => {
                      const idx = intradayData.findIndex(d => d.timestamp === currentTimestamp)
                      return idx === -1 ? 0 : idx
                    })()]}
                    onValueChange={(values) => {
                      const idx = values[0]
                      const snap = intradayData[idx]
                      if (snap) {
                        onCheckpointChange(snap.timestamp, false)
                      }
                    }}
                    className="cursor-pointer"
                  />
                </div>
              )}
            </>
          )}
          {/* Tooltip */}
          <div
            id="intraday-tooltip"
            className="absolute z-55 pointer-events-none bg-[#0E0E12] border border-[#2C2C35] rounded p-2 text-white shadow-lg opacity-0 transition-opacity duration-150 min-w-[150px]"
            style={{ fontFamily: typography.fontSans }}
          />
        </CardContent>
      </Card>

      {/* RIGHT CARD: 30-Day closing total 0DTE GEX trend */}
      <Card className="bg-[#0E0E12] border-[#1C1C24]">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div className="flex flex-col space-y-1">
            <CardTitle className="text-white text-sm font-semibold flex items-center gap-2">
              {ticker} | Historical 0DTE GEX
              {loadingHistorical && <RefreshCw className="h-3.5 w-3.5 text-gray-500 animate-spin" />}
            </CardTitle>
            <CardDescription className="text-gray-500 text-xs">
              Daily closing 0DTE GEX (bars) and Spot Price (line) over the last 30 days
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0 relative" ref={rightContainerRef}>
          {historicalData.length === 0 && !loadingHistorical ? (
            <div className="h-[350px] flex items-center justify-center text-xs text-gray-500 font-mono">
              No historical data available
            </div>
          ) : (
            <svg ref={rightSvgRef} width="100%" height={350} className="block overflow-visible" />
          )}
          {/* Tooltip */}
          <div
            id="historical-tooltip"
            className="absolute z-55 pointer-events-none bg-[#0E0E12] border border-[#2C2C35] rounded p-2 text-white shadow-lg opacity-0 transition-opacity duration-150 min-w-[140px]"
            style={{ fontFamily: typography.fontSans }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
