"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
import * as d3 from "d3"
import { 
  RefreshCw, 
  Activity,
  AlertCircle,
  HelpCircle
} from "lucide-react"
import { getOptionsNetFlow, NetFlowStrikeData } from "@/lib/backend-api"
import { colors, typography } from "@/lib/design-tokens"
import { 
  styleAxis, 
  drawGridLinesX, 
  drawHorizontalRefLine, 
  positionTooltip,
  HORIZONTAL_MARGINS 
} from "@/lib/d3-helpers"

interface OptionNetFlowDashboardProps {
  ticker: string
  selectedExpiries?: string[]
}

export function OptionNetFlowDashboard({ ticker, selectedExpiries }: OptionNetFlowDashboardProps) {
  const [data, setData] = useState<NetFlowStrikeData[]>([])
  const [spotPrice, setSpotPrice] = useState<number>(0.0)
  const [source, setSource] = useState<string>("")
  const [snapshotCount, setSnapshotCount] = useState<number>(0)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  

  // Refs for D3
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const volSvgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 800, height: 600 })

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) setDims({ width, height })
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Fetch Net Flow data
  const fetchNetFlow = useCallback(async (t: string) => {
    try {
      setIsLoading(true)
      setError(null)
      // Server now filters to ±15% strikes to minimize payload size
      const res = await getOptionsNetFlow(t, undefined, 15)
      if (res.success) {
        setData(res.data)
        setSpotPrice(res.spotPrice)
        setSource(res.source)
        setSnapshotCount(res.snapshotCount ?? 0)
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

  // Filter option net flow data based on selected expiries (from dashboard header selector)
  const filteredData = useMemo(() => {
    if (!selectedExpiries || selectedExpiries.length === 0) return data
    return data.filter(item => selectedExpiries.includes(item.expiration))
  }, [data, selectedExpiries])

  // Aggregate flow by strike for the charts
  const aggregatedStrikeData = useMemo(() => {
    const strikeMap: Record<number, { 
      strike: number, 
      expiration: string,
      callNetContracts: number, 
      putNetContracts: number, 
      callNetPremium: number, 
      putNetPremium: number,
      volume: number,
      openInterest: number,
      oiChange: number,
      eodSentiment: string
    }> = {}
    
    filteredData.forEach(item => {
      const strike = item.strike
      if (!strikeMap[strike]) {
        strikeMap[strike] = {
          strike,
          expiration: item.expiration,
          callNetContracts: 0,
          putNetContracts: 0,
          callNetPremium: 0,
          putNetPremium: 0,
          volume: 0,
          openInterest: 0,
          oiChange: 0,
          eodSentiment: item.eodSentiment
        }
      }
      
      const isCall = item.type === "C"
      const contracts = item.netContracts
      const premium = item.netPremium
      
      strikeMap[strike].volume += item.volume
      strikeMap[strike].openInterest += item.openInterest
      strikeMap[strike].oiChange += item.oiChange
      
      if (isCall) {
        strikeMap[strike].callNetContracts += contracts
        strikeMap[strike].callNetPremium += premium
      } else {
        strikeMap[strike].putNetContracts += contracts
        strikeMap[strike].putNetPremium += premium
      }
    })
    
    return Object.values(strikeMap).sort((a, b) => a.strike - b.strike)
  }, [filteredData])

  // Top Activity Leaderboard (based on absolute premium flow)
  const topActivity = useMemo(() => {
    const sorted = [...filteredData].sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium))
    return sorted.slice(0, 10)
  }, [filteredData])

  // Net aggregates for the summary cards
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

  // Server already returns ±15% strikes — use all aggregated data directly
  const scrollableStrikes = useMemo(() => {
    return aggregatedStrikeData.map(item => item.strike)
  }, [aggregatedStrikeData])

  // ATM Strike for centering
  const atmStrike = useMemo(() => {
    if (scrollableStrikes.length === 0) return spotPrice
    return scrollableStrikes.reduce((prev, curr) => 
      Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev, scrollableStrikes[0])
  }, [scrollableStrikes, spotPrice])

  // Fixed height per bar for perfect readability & scrolling matching GEX chart
  const barHeight = 44
  const chartHeight = scrollableStrikes.length * barHeight

  // Auto-scroll to center ATM strike on load/zoom changes
  useEffect(() => {
    if (!scrollContainerRef.current || !spotPrice || scrollableStrikes.length === 0) return

    const atmIndex = [...scrollableStrikes].reverse().findIndex(s => s === atmStrike)
    if (atmIndex !== -1) {
      const yPos = HORIZONTAL_MARGINS.top + atmIndex * barHeight
      const containerHeight = scrollContainerRef.current.clientHeight || 500
      scrollContainerRef.current.scrollTop = yPos - containerHeight / 2
    }
  }, [spotPrice, scrollableStrikes, atmStrike])

  // ─── D3 Rendering: Net Contracts (Left SVG) & Net Premium (Right SVG) ───
  useEffect(() => {
    if (!svgRef.current || !volSvgRef.current || scrollableStrikes.length === 0) return

    const chartWidth = dims.width / 2 - 8
    const margin = HORIZONTAL_MARGINS
    const width = chartWidth - margin.left - margin.right
    if (width <= 0 || chartHeight <= 0) return

    const d3Svg = d3.select(svgRef.current)
    const d3VolSvg = d3.select(volSvgRef.current)

    // Clear previous renders
    d3Svg.selectAll('*').remove()
    d3VolSvg.selectAll('*').remove()

    d3Svg.attr('width', chartWidth).attr('height', chartHeight + margin.top + margin.bottom)
    d3VolSvg.attr('width', chartWidth).attr('height', chartHeight + margin.top + margin.bottom)

    const gContracts = d3Svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const gPremium = d3VolSvg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Shared Y Scale (Strikes)
    const yScale = d3.scaleBand()
      .domain([...scrollableStrikes].reverse().map(String))
      .range([0, chartHeight])
      .padding(0.2)

    // Compute max absolute values for scales
    const activeStrikesData = aggregatedStrikeData.filter(item => scrollableStrikes.includes(item.strike))
    
    const maxContractsVal = d3.max(activeStrikesData.map(item => 
      Math.max(Math.abs(item.callNetContracts), Math.abs(item.putNetContracts))
    )) || 100
    const xScaleContracts = d3.scaleLinear()
      .domain([-maxContractsVal * 1.15, maxContractsVal * 1.15])
      .range([0, width])

    const maxPremiumVal = d3.max(activeStrikesData.map(item => 
      Math.max(Math.abs(item.callNetPremium), Math.abs(item.putNetPremium))
    )) || 5000
    const xScalePremium = d3.scaleLinear()
      .domain([-maxPremiumVal * 1.15, maxPremiumVal * 1.15])
      .range([0, width])

    // Grids
    drawGridLinesX(gContracts, xScaleContracts, chartHeight, 6)
    drawGridLinesX(gPremium, xScalePremium, chartHeight, 6)

    // Zero reference lines
    gContracts.append('line')
      .attr('x1', xScaleContracts(0)).attr('x2', xScaleContracts(0))
      .attr('y1', 0).attr('y2', chartHeight)
      .attr('stroke', '#222').attr('stroke-width', 1.2)

    gPremium.append('line')
      .attr('x1', xScalePremium(0)).attr('x2', xScalePremium(0))
      .attr('y1', 0).attr('y2', chartHeight)
      .attr('stroke', '#222').attr('stroke-width', 1.2)

    // Draw Bars for Net Contracts (Left)
    activeStrikesData.forEach(item => {
      const strikeStr = String(item.strike)
      const bandY = yScale(strikeStr)
      if (bandY === undefined) return
      
      const singleBarHeight = yScale.bandwidth() / 2 - 1

      // Call contracts bar (plotted directly: positive extends right, negative left)
      const callVal = item.callNetContracts
      const callX = callVal >= 0 ? xScaleContracts(0) : xScaleContracts(callVal)
      const callW = Math.abs(xScaleContracts(callVal) - xScaleContracts(0))
      const callColor = callVal >= 0 ? colors.accent.green : colors.accent.red

      gContracts.append('rect')
        .attr('class', 'bar-call-contracts')
        .attr('y', bandY)
        .attr('x', callX)
        .attr('width', Math.max(1, callW))
        .attr('height', singleBarHeight)
        .attr('fill', callColor)
        .attr('opacity', 0.85)
        .attr('rx', 1)

      // Put contracts bar (plotted negated: positive buying puts goes left, negative writing puts goes right)
      const putVal = item.putNetContracts
      const putValForPlot = -putVal
      const putX = putValForPlot >= 0 ? xScaleContracts(0) : xScaleContracts(putValForPlot)
      const putW = Math.abs(xScaleContracts(putValForPlot) - xScaleContracts(0))
      const putColor = putValForPlot >= 0 ? colors.accent.green : colors.accent.red

      gContracts.append('rect')
        .attr('class', 'bar-put-contracts')
        .attr('y', bandY + yScale.bandwidth() / 2)
        .attr('x', putX)
        .attr('width', Math.max(1, putW))
        .attr('height', singleBarHeight)
        .attr('fill', putColor)
        .attr('opacity', 0.85)
        .attr('rx', 1)
    })

    // Draw Bars for Net Premium (Right)
    activeStrikesData.forEach(item => {
      const strikeStr = String(item.strike)
      const bandY = yScale(strikeStr)
      if (bandY === undefined) return

      const singleBarHeight = yScale.bandwidth() / 2 - 1

      // Call premium bar (plotted directly: positive right, negative left)
      const callVal = item.callNetPremium
      const callX = callVal >= 0 ? xScalePremium(0) : xScalePremium(callVal)
      const callW = Math.abs(xScalePremium(callVal) - xScalePremium(0))
      const callColor = callVal >= 0 ? colors.accent.green : colors.accent.red

      gPremium.append('rect')
        .attr('class', 'bar-call-premium')
        .attr('y', bandY)
        .attr('x', callX)
        .attr('width', Math.max(1, callW))
        .attr('height', singleBarHeight)
        .attr('fill', callColor)
        .attr('opacity', 0.85)
        .attr('rx', 1)

      // Put premium bar (plotted negated: positive left, negative right)
      const putVal = item.putNetPremium
      const putValForPlot = -putVal
      const putX = putValForPlot >= 0 ? xScalePremium(0) : xScalePremium(putValForPlot)
      const putW = Math.abs(xScalePremium(putValForPlot) - xScalePremium(0))
      const putColor = putValForPlot >= 0 ? colors.accent.green : colors.accent.red

      gPremium.append('rect')
        .attr('class', 'bar-put-premium')
        .attr('y', bandY + yScale.bandwidth() / 2)
        .attr('x', putX)
        .attr('width', Math.max(1, putW))
        .attr('height', singleBarHeight)
        .attr('fill', putColor)
        .attr('opacity', 0.85)
        .attr('rx', 1)
    })

    // Spot Price Reference Lines
    const getClosestStrike = (val: number) => scrollableStrikes.reduce((prev, curr) =>
      Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev, scrollableStrikes[0])

    const spotStrikeYStr = String(getClosestStrike(spotPrice))
    const spotY = yScale(spotStrikeYStr)
    if (spotY !== undefined && spotPrice > 0) {
      const lineY = spotY + yScale.bandwidth() / 2
      drawHorizontalRefLine(gContracts, lineY, width, colors.accent.amber, `SPOT ${spotPrice.toFixed(0)}`)
      drawHorizontalRefLine(gPremium, lineY, width, colors.accent.amber, `SPOT ${spotPrice.toFixed(0)}`)
    }

    // Axes Left (Contracts)
    const yAxisL = d3.axisLeft(yScale).tickSize(0)
    const yAxisGL = gContracts.append('g').call(yAxisL)
    styleAxis(yAxisGL, { fontSize: 10 })

    const xAxisL = d3.axisBottom(xScaleContracts).ticks(6).tickFormat(d3.format(","))
    const xAxisGL = gContracts.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxisL)
    styleAxis(xAxisGL)

    // Axes Right (Premium)
    const yAxisR = d3.axisLeft(yScale).tickSize(0)
    const yAxisGR = gPremium.append('g').call(yAxisR)
    styleAxis(yAxisGR, { fontSize: 10 })

    const xAxisR = d3.axisBottom(xScalePremium).ticks(6).tickFormat(d => {
      const val = Math.abs(d as number)
      const sign = (d as number) >= 0 ? '+' : '-'
      if (val >= 1e6) return `${sign}${(val / 1e6).toFixed(1)}M`
      if (val >= 1e3) return `${sign}${(val / 1e3).toFixed(0)}k`
      return `${sign}${val}`
    })
    const xAxisGR = gPremium.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxisR)
    styleAxis(xAxisGR)

    // X-axis Labels
    gContracts.append('text')
      .attr('x', width / 2).attr('y', chartHeight + 32)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans)
      .style('font-size', '10px')
      .style('font-weight', '600')
      .text('Net Contracts (Bullish → | ← Bearish)')

    gPremium.append('text')
      .attr('x', width / 2).attr('y', chartHeight + 32)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans)
      .style('font-size', '10px')
      .style('font-weight', '600')
      .text('Net Premium Flow (Bullish → | ← Bearish)')

    // ─── Synchronized Hover Interactions ───
    const hoverLineContracts = gContracts.append('line')
      .attr('stroke', '#333').attr('stroke-width', 1).attr('stroke-dasharray', '2,2')
      .attr('x1', 0).attr('x2', width).attr('y1', 0).attr('y2', 0)
      .style('opacity', 0).style('pointer-events', 'none')

    const hoverLinePremium = gPremium.append('line')
      .attr('stroke', '#333').attr('stroke-width', 1).attr('stroke-dasharray', '2,2')
      .attr('x1', 0).attr('x2', width).attr('y1', 0).attr('y2', 0)
      .style('opacity', 0).style('pointer-events', 'none')

    const setupHover = (overlayG: d3.Selection<SVGGElement, unknown, null, undefined>) => {
      overlayG.append('rect')
        .attr('width', width)
        .attr('height', chartHeight)
        .attr('fill', 'transparent')
        .style('cursor', 'crosshair')
        .on('mousemove', (event: MouseEvent) => {
          const [, my] = d3.pointer(event)
          const bandStep = yScale.step()
          const idx = Math.floor(my / bandStep)
          if (idx < 0 || idx >= scrollableStrikes.length) return

          const strikeStr = yScale.domain()[idx]
          const strikeObj = activeStrikesData.find(s => String(s.strike) === strikeStr)
          if (!strikeObj) return

          const lineY = yScale(strikeStr)! + yScale.bandwidth() / 2

          // Sync hover lines
          hoverLineContracts.attr('y1', lineY).attr('y2', lineY).style('opacity', 1)
          hoverLinePremium.attr('y1', lineY).attr('y2', lineY).style('opacity', 1)

          // Custom Tooltip HTML
          if (tooltipRef.current && containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect()
            
            const formatContractsDiff = (val: number) => {
              const sign = val >= 0 ? '+' : ''
              const color = val >= 0 ? colors.accent.green : colors.accent.red
              return `<span style="color:${color}">${sign}${val.toLocaleString()}</span>`
            }

            const formatPremiumDiff = (val: number) => {
              const sign = val >= 0 ? '+' : '-'
              const absVal = Math.abs(val)
              const formatted = absVal >= 1e6 
                ? `$${(absVal / 1e6).toFixed(2)}M` 
                : absVal >= 1e3 
                  ? `$${(absVal / 1e3).toFixed(1)}k` 
                  : `$${absVal.toFixed(0)}`
              const color = val >= 0 ? colors.accent.green : colors.accent.red
              return `<span style="color:${color}">${sign}${formatted}</span>`
            }

            tooltipRef.current.innerHTML = `
              <div style="font-family:${typography.fontSans};font-size:11px;color:${colors.text.primary};font-weight:700;border-bottom:1px solid #1A1A1A;padding-bottom:4px;margin-bottom:6px">
                Strike $${strikeObj.strike.toFixed(1)}
              </div>
              <div style="font-family:${typography.fontMono};font-size:10px;display:flex;flex-direction:column;gap:3px">
                <div style="display:flex;justify-content:between;gap:20px">
                  <span style="color:${colors.text.secondary}">Call Net Vol:</span>
                  <span style="font-weight:bold">${formatContractsDiff(strikeObj.callNetContracts)}</span>
                </div>
                <div style="display:flex;justify-content:between;gap:20px">
                  <span style="color:${colors.text.secondary}">Put Net Vol:</span>
                  <span style="font-weight:bold">${formatContractsDiff(strikeObj.putNetContracts)}</span>
                </div>
                <div style="display:flex;justify-content:between;gap:20px;margin-top:2px;border-top:1px dashed #141414;padding-top:2px">
                  <span style="color:${colors.text.secondary}">Call Net Prem:</span>
                  <span style="font-weight:bold">${formatPremiumDiff(strikeObj.callNetPremium)}</span>
                </div>
                <div style="display:flex;justify-content:between;gap:20px">
                  <span style="color:${colors.text.secondary}">Put Net Prem:</span>
                  <span style="font-weight:bold">${formatPremiumDiff(strikeObj.putNetPremium)}</span>
                </div>
                <div style="display:flex;justify-content:between;gap:20px;margin-top:4px;border-top:1px solid #1A1A1A;padding-top:4px">
                  <span style="color:${colors.text.muted};font-size:9px">OI Change:</span>
                  <span style="font-weight:bold;color:${strikeObj.oiChange >= 0 ? colors.accent.green : colors.accent.red};font-size:9px">
                    ${strikeObj.oiChange >= 0 ? '+' : ''}${strikeObj.oiChange.toLocaleString()}
                  </span>
                </div>
                <div style="display:flex;justify-content:between;gap:20px">
                  <span style="color:${colors.text.muted};font-size:9px">EOD Sentiment:</span>
                  <span style="font-weight:bold;color:#FFF;font-size:9px">${strikeObj.eodSentiment}</span>
                </div>
              </div>
            `
            tooltipRef.current.style.opacity = '0.95'
            positionTooltip(tooltipRef.current, event, containerRect)
          }
        })
        .on('mouseleave', () => {
          hoverLineContracts.style('opacity', 0)
          hoverLinePremium.style('opacity', 0)
          if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
        })
    }

    setupHover(gContracts)
    setupHover(gPremium)

  }, [scrollableStrikes, aggregatedStrikeData, dims.width, chartHeight, spotPrice])

  const formatNotional = (val: number) => {
    const absVal = Math.abs(val)
    const sign = val < 0 ? "-" : ""
    if (absVal >= 1e6) return `${sign}${(absVal / 1e6).toFixed(2)}M`
    if (absVal >= 1e3) return `${sign}${(absVal / 1e3).toFixed(1)}K`
    return `${sign}$${absVal.toFixed(0)}`
  }

  const formatContracts = (val: number) => {
    const absVal = Math.abs(val)
    const sign = val < 0 ? "-" : ""
    if (absVal >= 1e3) return `${sign}${(absVal / 1e3).toFixed(1)}K`
    return `${sign}${absVal.toFixed(0)}`
  }

  // If there's no data, return null (Show nothing)
  if (!isLoading && data.length === 0) {
    return null
  }

  return (
    <div 
      ref={containerRef}
      className="flex flex-col lg:flex-row h-full bg-[#050608] text-[#D1D4DC] font-sans antialiased border border-[#14161C] rounded-lg overflow-y-auto lg:overflow-hidden select-none relative"
    >
      
      {/* LEFT COLUMN: Main Chart SVGs & Config */}
      <div className="flex-1 flex flex-col min-w-0 lg:h-full border-b lg:border-b-0 lg:border-r border-[#14161C]">
        
        {/* HEADER CONTROLS */}
        <div className="flex flex-row items-center justify-between px-5 py-3 border-b border-[#13161C] bg-[#0A0C10] gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold font-mono tracking-tight text-white uppercase flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-[#FFD600]" />
              <span>Net Flow by Strike (EOD)</span>
            </h1>

          </div>

          <div className="flex items-center gap-3">
            {/* Source Classification Badge */}
            {source && (
              <span className={`px-2 py-0.5 rounded text-[9px] font-mono border uppercase ${
                source.includes("midpoint") 
                  ? "bg-[#092B1D] text-[#00E676] border-[#00E676]/30"
                  : "bg-[#2A2307] text-[#FFD600] border-[#FFD600]/30"
              }`}>
                {source.includes("midpoint") ? "5m Midpoint" : "EOD IV/OI Proxy"}
              </span>
            )}

            {/* Snapshot count badge */}
            {snapshotCount > 0 && (
              <span className="px-2 py-0.5 rounded text-[9px] font-mono border bg-[#0D1015] text-[#888] border-[#1A1A1E]">
                {snapshotCount} snapshots
              </span>
            )}

            <button
              onClick={() => fetchNetFlow(ticker)}
              disabled={isLoading}
              className="flex items-center justify-center w-7 h-7 bg-[#0D1015] border border-[#20242D] rounded hover:bg-[#1C202E] disabled:opacity-50 text-gray-400 hover:text-white"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-white' : ''}`} />
            </button>
          </div>
        </div>

        {/* D3 SCROLLABLE CHART SVGs */}
        <div className="flex-1 min-h-[300px] bg-[#020203] relative flex items-center justify-center">
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
          ) : scrollableStrikes.length > 0 ? (
            <div 
              ref={scrollContainerRef}
              className="w-full h-full overflow-y-auto max-h-[750px] terminal-scrollbar relative"
            >
              <div className="flex gap-4 w-full px-4">
                <div className="flex-1">
                  <svg ref={svgRef} className="w-full" style={{ height: `${chartHeight + HORIZONTAL_MARGINS.top + HORIZONTAL_MARGINS.bottom}px` }} />
                </div>
                <div className="flex-1">
                  <svg ref={volSvgRef} className="w-full" style={{ height: `${chartHeight + HORIZONTAL_MARGINS.top + HORIZONTAL_MARGINS.bottom}px` }} />
                </div>
              </div>
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

      {/* Sync Hover Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none opacity-0 bg-[#070709]/95 border border-[#141416]/90 rounded p-3 flex flex-col gap-2 shadow-2xl z-30 min-w-[260px] transition-opacity duration-100 text-[#D4D4D8]"
        style={{ width: "max-content" }}
      />
    </div>
  )
}
