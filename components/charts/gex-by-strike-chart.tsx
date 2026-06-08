"use client"

import { useMemo, useRef, useEffect, useState } from "react"
import * as d3 from "d3"
import type { OptionData } from "@/lib/types"
import { computeGEXByStrike, computeVolumeByStrike, findZeroGammaLevel, type PricingMethod } from "@/lib/calculations"
import { colors, typography } from "@/lib/design-tokens"
import {
  styleAxis,
  drawGridLinesX,
  drawHorizontalRefLine,
  gexFillColor,
  gexColor,
  formatBillions,
  formatCompact,
  HORIZONTAL_MARGINS,
} from "@/lib/d3-helpers"
import { PricingMethodToggle } from "../pricing-method-toggle"

interface GEXByStrikeChartProps {
  data: OptionData[]
  ticker: string
  spotPrice: number
  selectedExpiries: string[]
  pricingMethod: PricingMethod
  onPricingMethodChange: (method: PricingMethod) => void
  market?: 'USA' | 'INDIA'
}

export function GEXByStrikeChart({
  data,
  ticker,
  spotPrice,
  selectedExpiries,
  pricingMethod,
  onPricingMethodChange,
  market = 'USA',
}: GEXByStrikeChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const volSvgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [showAbsoluteGEX, setShowAbsoluteGEX] = useState(false)
  const [showVolumeChart, setShowVolumeChart] = useState(true)
  const [activeZoom, setActiveZoom] = useState<number | null>(null)
  const [dims, setDims] = useState({ width: 800, height: 600 })

  const effectivePricingMethod = market === 'INDIA' ? 'black-scholes' : pricingMethod

  // 1. Set default zoom based on ticker: 1% for SPX/SPY, 2% for others
  useEffect(() => {
    if (ticker === 'SPX' || ticker === 'SPY') {
      setActiveZoom(1)
    } else {
      setActiveZoom(2)
    }
  }, [ticker])

  // Filter data by selected expiries
  const filteredData = useMemo(() => {
    if (selectedExpiries.length === 0) return data
    return data.filter(o => selectedExpiries.includes(o.expiration.toISOString().split("T")[0]))
  }, [data, selectedExpiries])

  const selectedExpiryLabel = selectedExpiries.length === 0
    ? "All Expiries"
    : selectedExpiries.length === 1
      ? selectedExpiries[0]
      : `${selectedExpiries.length} Expiries`

  // Compute GEX and volume
  const gexByStrike = useMemo(() => computeGEXByStrike(spotPrice, filteredData, effectivePricingMethod), [spotPrice, filteredData, effectivePricingMethod])
  const volumeByStrike = useMemo(() => computeVolumeByStrike(filteredData), [filteredData])
  const zeroGammaLevel = useMemo(() => findZeroGammaLevel(filteredData, spotPrice), [filteredData, spotPrice])

  // Merge strikes
  const allStrikes = useMemo(() => Array.from(new Set([
    ...gexByStrike.map(item => item.strike),
    ...volumeByStrike.map(item => item.strike)
  ])).sort((a, b) => a - b), [gexByStrike, volumeByStrike])

  // Filter scrollable strikes to ±15% range around spot price for premium readability & scroll performance
  const scrollableStrikes = useMemo(() => {
    return allStrikes.filter(s => s >= spotPrice * 0.85 && s <= spotPrice * 1.15)
  }, [allStrikes, spotPrice])

  // ATM strike
  const atmStrike = useMemo(() => {
    if (scrollableStrikes.length === 0) return spotPrice
    return scrollableStrikes.reduce((prev, curr) => Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev, scrollableStrikes[0])
  }, [scrollableStrikes, spotPrice])

  // Map to scrollable strikes (pre-computed values)
  const gammaValues = useMemo(() => scrollableStrikes.map(s => gexByStrike.find(i => i.strike === s)?.gex || 0), [scrollableStrikes, gexByStrike])
  const volumeValues = useMemo(() => scrollableStrikes.map(s => volumeByStrike.find(i => i.strike === s)?.volume || 0), [scrollableStrikes, volumeByStrike])

  // Absolute GEX
  const { callGEX, putGEX } = useMemo(() => {
    const callGEX = scrollableStrikes.map(strike => {
      const callOptions = filteredData.filter(o => o.strike === strike && o.type === "C")
      let gex = 0
      callOptions.forEach(o => { if (o.GEX_BS) gex += Math.abs(o.GEX_BS) })
      return gex / 1e9
    })
    const putGEX = scrollableStrikes.map(strike => {
      const putOptions = filteredData.filter(o => o.strike === strike && o.type === "P")
      let gex = 0
      putOptions.forEach(o => { if (o.GEX_BS) gex += Math.abs(o.GEX_BS) })
      return -gex / 1e9
    })
    return { callGEX, putGEX }
  }, [scrollableStrikes, filteredData])

  // Zoom range constraints to compute the x-axis scale range
  const xDomain = useMemo<[number, number]>(() => {
    const zoomPct = activeZoom || 10 // Default to 10% bounds if zoom is null
    const range = atmStrike * (zoomPct / 100)
    
    // Find strikes within the active zoom window to determine max x-axis scale
    const zoomStrikes = scrollableStrikes.filter(s => s >= atmStrike - range && s <= atmStrike + range)
    if (zoomStrikes.length === 0) return [-1, 1]

    if (showAbsoluteGEX) {
      const maxCall = d3.max(zoomStrikes.map(s => {
        const idx = scrollableStrikes.indexOf(s)
        return idx !== -1 ? Math.abs(callGEX[idx]) : 0
      })) || 1
      const maxPut = d3.max(zoomStrikes.map(s => {
        const idx = scrollableStrikes.indexOf(s)
        return idx !== -1 ? Math.abs(putGEX[idx]) : 0
      })) || 1
      const maxVal = Math.max(maxCall, maxPut) * 1.15
      return [-maxVal, maxVal]
    } else {
      const maxNet = d3.max(zoomStrikes.map(s => {
        const idx = scrollableStrikes.indexOf(s)
        return idx !== -1 ? Math.abs(gammaValues[idx]) : 0
      })) || 1
      const maxVal = maxNet * 1.15
      return [-maxVal, maxVal]
    }
  }, [scrollableStrikes, activeZoom, atmStrike, showAbsoluteGEX, callGEX, putGEX, gammaValues])

  // Auto-scroll to center ATM strike
  useEffect(() => {
    if (!scrollContainerRef.current || !spotPrice || scrollableStrikes.length === 0) return

    // Find the index of the ATM strike in the reversed array (since yScale domain is reversed)
    const atmIndex = [...scrollableStrikes].reverse().findIndex(s => s === atmStrike)
    if (atmIndex !== -1) {
      const barHeight = 22
      const margin = HORIZONTAL_MARGINS
      const yPos = margin.top + atmIndex * barHeight
      const containerHeight = scrollContainerRef.current.clientHeight || 500
      scrollContainerRef.current.scrollTop = yPos - containerHeight / 2
    }
  }, [spotPrice, scrollableStrikes, atmStrike])

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

  // Fixed height per bar for perfect readability & scrolling
  const barHeight = 22
  const chartHeight = scrollableStrikes.length * barHeight

  // ─── D3 Gamma Chart ──────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || scrollableStrikes.length === 0) return

    const chartWidth = showVolumeChart ? dims.width / 2 - 8 : dims.width
    const margin = HORIZONTAL_MARGINS
    const width = chartWidth - margin.left - margin.right
    if (width <= 0 || chartHeight <= 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', chartWidth).attr('height', chartHeight + margin.top + margin.bottom)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Scales
    const yScale = d3.scaleBand()
      .domain([...scrollableStrikes].reverse().map(String))
      .range([0, chartHeight])
      .padding(0.15)

    const xScale = d3.scaleLinear().domain(xDomain).range([0, width])

    // Grid
    drawGridLinesX(g, xScale, chartHeight, 8)

    // Zero line
    g.append('line')
      .attr('x1', xScale(0)).attr('x2', xScale(0))
      .attr('y1', 0).attr('y2', chartHeight)
      .attr('stroke', '#2A2A2A').attr('stroke-width', 1)

    // Bars
    if (showAbsoluteGEX) {
      // Call bars
      g.selectAll('.bar-call')
        .data(scrollableStrikes)
        .join('rect')
        .attr('class', 'bar-call')
        .attr('y', d => yScale(String(d))!)
        .attr('x', (_, i) => {
          const val = callGEX[i]
          const x0 = xScale(0)
          const x1 = xScale(val)
          const clampedX0 = Math.max(0, Math.min(width, x0))
          const clampedX1 = Math.max(0, Math.min(width, x1))
          return Math.min(clampedX0, clampedX1)
        })
        .attr('width', (_, i) => {
          const val = callGEX[i]
          const x0 = xScale(0)
          const x1 = xScale(val)
          const clampedX0 = Math.max(0, Math.min(width, x0))
          const clampedX1 = Math.max(0, Math.min(width, x1))
          return Math.abs(clampedX1 - clampedX0)
        })
        .attr('height', yScale.bandwidth())
        .attr('fill', colors.accentAlpha.green50)
        .attr('stroke', colors.accent.green)
        .attr('stroke-width', 0.5)
        .attr('rx', 1)

      // Put bars
      g.selectAll('.bar-put')
        .data(scrollableStrikes)
        .join('rect')
        .attr('class', 'bar-put')
        .attr('y', d => yScale(String(d))!)
        .attr('x', (_, i) => {
          const val = putGEX[i]
          const x0 = xScale(0)
          const x1 = xScale(val)
          const clampedX0 = Math.max(0, Math.min(width, x0))
          const clampedX1 = Math.max(0, Math.min(width, x1))
          return Math.min(clampedX0, clampedX1)
        })
        .attr('width', (_, i) => {
          const val = putGEX[i]
          const x0 = xScale(0)
          const x1 = xScale(val)
          const clampedX0 = Math.max(0, Math.min(width, x0))
          const clampedX1 = Math.max(0, Math.min(width, x1))
          return Math.abs(clampedX1 - clampedX0)
        })
        .attr('height', yScale.bandwidth())
        .attr('fill', colors.accentAlpha.red50)
        .attr('stroke', colors.accent.red)
        .attr('stroke-width', 0.5)
        .attr('rx', 1)
    } else {
      // Net GEX bars
      g.selectAll('.bar-net')
        .data(scrollableStrikes)
        .join('rect')
        .attr('class', 'bar-net')
        .attr('y', d => yScale(String(d))!)
        .attr('x', (_, i) => {
          const val = gammaValues[i]
          const x0 = xScale(0)
          const x1 = xScale(val)
          const clampedX0 = Math.max(0, Math.min(width, x0))
          const clampedX1 = Math.max(0, Math.min(width, x1))
          return Math.min(clampedX0, clampedX1)
        })
        .attr('width', (_, i) => {
          const val = gammaValues[i]
          const x0 = xScale(0)
          const x1 = xScale(val)
          const clampedX0 = Math.max(0, Math.min(width, x0))
          const clampedX1 = Math.max(0, Math.min(width, x1))
          return Math.abs(clampedX1 - clampedX0)
        })
        .attr('height', yScale.bandwidth())
        .attr('fill', (_, i) => gexFillColor(gammaValues[i]))
        .attr('stroke', (_, i) => gexColor(gammaValues[i]))
        .attr('stroke-width', 0.5)
        .attr('rx', 1)
    }

    // Spot price reference line
    const spotYStr = String(scrollableStrikes.reduce((prev, curr) =>
      Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev, scrollableStrikes[0]))
    const spotY = yScale(spotYStr)
    if (spotY !== undefined) {
      drawHorizontalRefLine(g, spotY + yScale.bandwidth() / 2, width, colors.accent.amber, `SPOT ${spotPrice.toFixed(0)}`)
    }

    // Gamma flip reference line
    if (zeroGammaLevel) {
      const flipStr = String(scrollableStrikes.reduce((prev, curr) =>
        Math.abs(curr - zeroGammaLevel) < Math.abs(prev - zeroGammaLevel) ? curr : prev, scrollableStrikes[0]))
      const flipY = yScale(flipStr)
      if (flipY !== undefined) {
        drawHorizontalRefLine(g, flipY + yScale.bandwidth() / 2, width, colors.accent.magenta, `Γ-FLIP ${zeroGammaLevel.toFixed(0)}`, { dashArray: '4,4' })
      }
    }

    // Axes
    const yAxis = d3.axisLeft(yScale).tickSize(0)
    const yAxisG = g.append('g').call(yAxis)
    styleAxis(yAxisG, { fontSize: 10 })

    const xAxis = d3.axisBottom(xScale).ticks(6).tickFormat(d => formatBillions(d as number))
    const xAxisG = g.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis)
    styleAxis(xAxisG)

    // X-axis label
    g.append('text')
      .attr('x', width / 2).attr('y', chartHeight + 36)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans)
      .style('font-size', '11px')
      .text(showAbsoluteGEX ? 'Gamma (Calls → | ← Puts)' : 'Net Gamma')

    // Title / Header (Fixed atop scroll container)
    svg.append('text')
      .attr('x', margin.left + width / 2).attr('y', 16)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '12px')
      .style('font-weight', '700')
      .text(`${ticker} ${showAbsoluteGEX ? 'Absolute' : 'Net'} Gamma by Strike (${selectedExpiryLabel})`)

    // Hover interactions
    const hoverLine = g.append('line')
      .attr('stroke', '#444').attr('stroke-width', 1).attr('stroke-dasharray', '3,3')
      .attr('x1', 0).attr('x2', width).attr('y1', 0).attr('y2', 0)
      .style('opacity', 0).style('pointer-events', 'none')

    g.append('rect')
      .attr('width', width).attr('height', chartHeight)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent) => {
        const [, my] = d3.pointer(event)
        const bandStep = yScale.step()
        const idx = Math.floor(my / bandStep)
        if (idx < 0 || idx >= scrollableStrikes.length) return

        const domain = yScale.domain()
        const strikeStr = domain[idx]
        const strikeIdx = scrollableStrikes.findIndex(s => String(s) === strikeStr)
        if (strikeIdx === -1) return

        hoverLine
          .attr('y1', yScale(strikeStr)! + yScale.bandwidth() / 2)
          .attr('y2', yScale(strikeStr)! + yScale.bandwidth() / 2)
          .style('opacity', 1)

        if (tooltipRef.current && containerRef.current) {
          const strike = scrollableStrikes[strikeIdx]
          const value = showAbsoluteGEX
            ? `Call: ${callGEX[strikeIdx].toFixed(3)}B | Put: ${Math.abs(putGEX[strikeIdx]).toFixed(3)}B`
            : `Net GEX: ${gammaValues[strikeIdx] >= 0 ? '+' : ''}${gammaValues[strikeIdx].toFixed(3)}B`
          tooltipRef.current.innerHTML = `
            <div style="font-family:${typography.fontSans};font-size:12px;color:${colors.text.primary};font-weight:600">
              Strike ${strike.toFixed(0)}
            </div>
            <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.text.secondary};margin-top:2px">
              ${value}
            </div>
          `
          const rect = containerRef.current.getBoundingClientRect()
          const cx = event.clientX - rect.left
          const cy = event.clientY - rect.top
          tooltipRef.current.style.left = `${cx + 14}px`
          tooltipRef.current.style.top = `${cy - 20}px`
          tooltipRef.current.style.opacity = '1'
        }
      })
      .on('mouseleave', () => {
        hoverLine.style('opacity', 0)
        if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
      })

  }, [scrollableStrikes, gammaValues, callGEX, putGEX, showAbsoluteGEX, dims, showVolumeChart, spotPrice, zeroGammaLevel, ticker, selectedExpiryLabel, xDomain])

  // ─── D3 Volume Chart ─────────────────────────────────────────
  useEffect(() => {
    if (!volSvgRef.current || !showVolumeChart || scrollableStrikes.length === 0) return

    const chartWidth = dims.width / 2 - 8
    const margin = HORIZONTAL_MARGINS
    const width = chartWidth - margin.left - margin.right
    if (width <= 0 || chartHeight <= 0) return

    const svg = d3.select(volSvgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', chartWidth).attr('height', chartHeight + margin.top + margin.bottom)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const yScale = d3.scaleBand()
      .domain([...scrollableStrikes].reverse().map(String))
      .range([0, chartHeight])
      .padding(0.15)

    const maxVol = (d3.max(volumeValues) || 1) * 1.15
    const xScale = d3.scaleLinear().domain([0, maxVol]).range([0, width])

    // Grid
    drawGridLinesX(g, xScale, chartHeight, 6)

    // Bars
    g.selectAll('.bar-vol')
      .data(scrollableStrikes)
      .join('rect')
      .attr('class', 'bar-vol')
      .attr('y', d => yScale(String(d))!)
      .attr('x', 0)
      .attr('width', (_, i) => xScale(volumeValues[i]))
      .attr('height', yScale.bandwidth())
      .attr('fill', colors.accentAlpha.cyan40)
      .attr('stroke', colors.accent.cyan)
      .attr('stroke-width', 0.5)
      .attr('rx', 1)

    // Axes
    const yAxis = d3.axisLeft(yScale).tickSize(0)
    const yAxisG = g.append('g').call(yAxis)
    styleAxis(yAxisG, { fontSize: 10 })

    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d => formatCompact(d as number))
    const xAxisG = g.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis)
    styleAxis(xAxisG)

    g.append('text')
      .attr('x', width / 2).attr('y', chartHeight + 36)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans)
      .style('font-size', '11px')
      .text('Volume (Contracts)')

    svg.append('text')
      .attr('x', margin.left + width / 2).attr('y', 16)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '12px')
      .style('font-weight', '700')
      .text(`${ticker} Volume by Strike`)

    // Hover interactions
    const hoverLine = g.append('line')
      .attr('stroke', '#444').attr('stroke-width', 1).attr('stroke-dasharray', '3,3')
      .attr('x1', 0).attr('x2', width).attr('y1', 0).attr('y2', 0)
      .style('opacity', 0).style('pointer-events', 'none')

    g.append('rect')
      .attr('width', width).attr('height', chartHeight)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent) => {
        const [, my] = d3.pointer(event)
        const bandStep = yScale.step()
        const idx = Math.floor(my / bandStep)
        if (idx < 0 || idx >= scrollableStrikes.length) return

        const domain = yScale.domain()
        const strikeStr = domain[idx]
        const strikeIdx = scrollableStrikes.findIndex(s => String(s) === strikeStr)
        if (strikeIdx === -1) return

        hoverLine
          .attr('y1', yScale(strikeStr)! + yScale.bandwidth() / 2)
          .attr('y2', yScale(strikeStr)! + yScale.bandwidth() / 2)
          .style('opacity', 1)

        if (tooltipRef.current && containerRef.current) {
          const strike = scrollableStrikes[strikeIdx]
          const vol = volumeValues[strikeIdx]
          tooltipRef.current.innerHTML = `
            <div style="font-family:${typography.fontSans};font-size:12px;color:${colors.text.primary};font-weight:600">
              Strike ${strike.toFixed(0)}
            </div>
            <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.accent.cyan};margin-top:2px">
              Volume: ${vol.toLocaleString()} Contracts
            </div>
          `
          const rect = containerRef.current.getBoundingClientRect()
          const cx = event.clientX - rect.left
          const cy = event.clientY - rect.top
          tooltipRef.current.style.left = `${cx + 14}px`
          tooltipRef.current.style.top = `${cy - 20}px`
          tooltipRef.current.style.opacity = '1'
        }
      })
      .on('mouseleave', () => {
        hoverLine.style('opacity', 0)
        if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
      })

  }, [scrollableStrikes, volumeValues, dims, showVolumeChart, ticker, containerRef, tooltipRef])

  // Zoom controls
  const zoomPercents = [1, 2, 3, 5, 10, 20, 30]

  return (
    <div ref={containerRef} className="flex flex-col gap-3 w-full h-full overflow-hidden bg-[#0A0A0A] rounded p-3 relative">
      {/* Controls */}
      <div className="flex flex-row justify-between items-center gap-3">
        {/* Zoom pills */}
        <div className="flex flex-wrap gap-1.5">
          {zoomPercents.map(p => (
            <button
              key={p}
              className={`px-2 py-0.5 rounded text-xxs font-mono border transition-colors ${
                activeZoom === p
                  ? 'bg-[#1A1A1A] text-terminal-green border-terminal-green/30'
                  : 'bg-transparent text-[#525252] border-[#1A1A1A] hover:border-[#333]'
              }`}
              onClick={() => setActiveZoom(p)}
              type="button"
            >
              ±{p}%
            </button>
          ))}
          <button
            className={`px-2 py-0.5 rounded text-xxs font-mono border transition-colors ${
              activeZoom === null
                ? 'bg-[#1A1A1A] text-terminal-green border-terminal-green/30'
                : 'bg-transparent text-[#525252] border-[#1A1A1A] hover:border-[#333]'
            }`}
            onClick={() => setActiveZoom(null)}
            type="button"
          >
            RESET
          </button>
        </div>
        
        {/* Right controls */}
        <div className="flex items-center gap-2">
          {market === 'USA' ? (
            <PricingMethodToggle 
              pricingMethod={pricingMethod}
              onPricingMethodChange={onPricingMethodChange}
            />
          ) : (
            <span className="text-xxs text-[#525252] font-mono px-2 py-1 border border-[#1A1A1A] rounded">
              BLACK-SCHOLES (EUR)
            </span>
          )}
          
          <button
            className={`px-2 py-0.5 rounded text-xxs font-mono border transition-colors ${
              showAbsoluteGEX
                ? 'text-terminal-green border-terminal-green/30'
                : 'text-terminal-purple border-terminal-purple/30'
            }`}
            onClick={() => setShowAbsoluteGEX(!showAbsoluteGEX)}
            type="button"
          >
            {showAbsoluteGEX ? "ABS" : "NET"}
          </button>
          
          <button
            className={`px-1.5 py-0.5 rounded text-xxs font-mono border transition-colors ${
              showVolumeChart
                ? 'text-terminal-cyan border-terminal-cyan/30'
                : 'text-[#525252] border-[#1A1A1A]'
            }`}
            onClick={() => setShowVolumeChart(!showVolumeChart)}
            type="button"
            title={showVolumeChart ? "Hide Volume" : "Show Volume"}
          >
            VOL
          </button>
        </div>
      </div>
      
      {/* Scrollable wrapper for charts */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 min-h-[300px] overflow-y-auto max-h-[600px] border border-[#1A1A1A] rounded bg-black terminal-scrollbar relative"
      >
        <div className="flex gap-4 w-full">
          <div className="flex-1">
            <svg ref={svgRef} className="w-full" style={{ height: `${chartHeight + HORIZONTAL_MARGINS.top + HORIZONTAL_MARGINS.bottom}px` }} />
          </div>
          {showVolumeChart && (
            <div className="flex-1">
              <svg ref={volSvgRef} className="w-full" style={{ height: `${chartHeight + HORIZONTAL_MARGINS.top + HORIZONTAL_MARGINS.bottom}px` }} />
            </div>
          )}
        </div>
      </div>

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none z-50 px-3 py-2 rounded border transition-opacity duration-100"
        style={{
          opacity: 0,
          backgroundColor: '#111111',
          borderColor: '#1A1A1A',
        }}
      />
    </div>
  )
}
