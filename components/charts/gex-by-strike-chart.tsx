"use client"

import { useMemo, useRef, useEffect, useState, useCallback } from "react"
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
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [showAbsoluteGEX, setShowAbsoluteGEX] = useState(false)
  const [showVolumeChart, setShowVolumeChart] = useState(true)
  const [activeZoom, setActiveZoom] = useState<number | null>(null)
  const [dims, setDims] = useState({ width: 800, height: 600 })

  const effectivePricingMethod = market === 'INDIA' ? 'black-scholes' : pricingMethod

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

  // ATM strike
  const atmStrike = useMemo(() => {
    if (allStrikes.length === 0) return spotPrice
    return allStrikes.reduce((prev, curr) => Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev, allStrikes[0])
  }, [allStrikes, spotPrice])

  // Zoom filtering
  const filteredStrikes = useMemo(() => {
    if (!activeZoom) return allStrikes
    const range = atmStrike * (activeZoom / 100)
    return allStrikes.filter(s => s >= atmStrike - range && s <= atmStrike + range)
  }, [allStrikes, atmStrike, activeZoom])

  // Map to filtered strikes
  const gammaValues = useMemo(() => filteredStrikes.map(s => gexByStrike.find(i => i.strike === s)?.gex || 0), [filteredStrikes, gexByStrike])
  const volumeValues = useMemo(() => filteredStrikes.map(s => volumeByStrike.find(i => i.strike === s)?.volume || 0), [filteredStrikes, volumeByStrike])

  // Absolute GEX
  const { callGEX, putGEX } = useMemo(() => {
    const callGEX = filteredStrikes.map(strike => {
      const callOptions = filteredData.filter(o => o.strike === strike && o.type === "C")
      let gex = 0
      callOptions.forEach(o => { if (o.GEX_BS) gex += Math.abs(o.GEX_BS) })
      return gex / 1e9
    })
    const putGEX = filteredStrikes.map(strike => {
      const putOptions = filteredData.filter(o => o.strike === strike && o.type === "P")
      let gex = 0
      putOptions.forEach(o => { if (o.GEX_BS) gex += Math.abs(o.GEX_BS) })
      return -gex / 1e9
    })
    return { callGEX, putGEX }
  }, [filteredStrikes, filteredData])

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

  // ─── D3 Gamma Chart ──────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || filteredStrikes.length === 0) return

    const chartWidth = showVolumeChart ? dims.width / 2 - 8 : dims.width
    const margin = HORIZONTAL_MARGINS
    const width = chartWidth - margin.left - margin.right
    const height = dims.height - margin.top - margin.bottom
    if (width <= 0 || height <= 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', chartWidth).attr('height', dims.height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Scales
    const yScale = d3.scaleBand()
      .domain([...filteredStrikes].reverse().map(String))
      .range([0, height])
      .padding(0.15)

    let xDomain: [number, number]
    if (showAbsoluteGEX) {
      const maxCall = d3.max(callGEX.map(Math.abs)) || 1
      const maxPut = d3.max(putGEX.map(Math.abs)) || 1
      const maxVal = Math.max(maxCall, maxPut) * 1.1
      xDomain = [-maxVal, maxVal]
    } else {
      const maxNet = (d3.max(gammaValues.map(Math.abs)) || 1) * 1.1
      xDomain = [-maxNet, maxNet]
    }

    const xScale = d3.scaleLinear().domain(xDomain).range([0, width])

    // Grid
    drawGridLinesX(g, xScale, height, 8)

    // Zero line
    g.append('line')
      .attr('x1', xScale(0)).attr('x2', xScale(0))
      .attr('y1', 0).attr('y2', height)
      .attr('stroke', '#2A2A2A').attr('stroke-width', 1)

    // Bars
    if (showAbsoluteGEX) {
      // Call bars
      g.selectAll('.bar-call')
        .data(filteredStrikes)
        .join('rect')
        .attr('class', 'bar-call')
        .attr('y', (_, i) => yScale(String(filteredStrikes[i]))!)
        .attr('x', (_, i) => xScale(Math.min(0, callGEX[i])))
        .attr('width', (_, i) => Math.abs(xScale(callGEX[i]) - xScale(0)))
        .attr('height', yScale.bandwidth() / 2)
        .attr('fill', colors.accentAlpha.green50)
        .attr('stroke', colors.accent.green)
        .attr('stroke-width', 0.5)
        .attr('rx', 1)

      // Put bars
      g.selectAll('.bar-put')
        .data(filteredStrikes)
        .join('rect')
        .attr('class', 'bar-put')
        .attr('y', (_, i) => yScale(String(filteredStrikes[i]))! + yScale.bandwidth() / 2)
        .attr('x', (_, i) => xScale(Math.min(0, putGEX[i])))
        .attr('width', (_, i) => Math.abs(xScale(putGEX[i]) - xScale(0)))
        .attr('height', yScale.bandwidth() / 2)
        .attr('fill', colors.accentAlpha.red50)
        .attr('stroke', colors.accent.red)
        .attr('stroke-width', 0.5)
        .attr('rx', 1)
    } else {
      // Net GEX bars
      g.selectAll('.bar-net')
        .data(filteredStrikes)
        .join('rect')
        .attr('class', 'bar-net')
        .attr('y', (_, i) => yScale(String(filteredStrikes[i]))!)
        .attr('x', (_, i) => xScale(Math.min(0, gammaValues[i])))
        .attr('width', (_, i) => Math.abs(xScale(gammaValues[i]) - xScale(0)))
        .attr('height', yScale.bandwidth())
        .attr('fill', (_, i) => gexFillColor(gammaValues[i]))
        .attr('stroke', (_, i) => gexColor(gammaValues[i]))
        .attr('stroke-width', 0.5)
        .attr('rx', 1)
    }

    // Spot price reference line
    const spotYStr = String(allStrikes.reduce((prev, curr) =>
      Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev, allStrikes[0]))
    const spotY = yScale(spotYStr)
    if (spotY !== undefined) {
      drawHorizontalRefLine(g, spotY + yScale.bandwidth() / 2, width, colors.accent.amber, `SPOT ${spotPrice.toFixed(0)}`)
    }

    // Gamma flip reference line
    if (zeroGammaLevel) {
      const flipStr = String(allStrikes.reduce((prev, curr) =>
        Math.abs(curr - zeroGammaLevel) < Math.abs(prev - zeroGammaLevel) ? curr : prev, allStrikes[0]))
      const flipY = yScale(flipStr)
      if (flipY !== undefined) {
        drawHorizontalRefLine(g, flipY + yScale.bandwidth() / 2, width, colors.accent.magenta, `Γ-FLIP ${zeroGammaLevel.toFixed(0)}`, { dashArray: '4,4' })
      }
    }

    // Axes
    const yAxis = d3.axisLeft(yScale).tickSize(0)
    const yAxisG = g.append('g').call(yAxis)
    styleAxis(yAxisG, { fontSize: filteredStrikes.length > 40 ? 8 : 10 })

    // Only show every Nth label if too many
    if (filteredStrikes.length > 30) {
      const step = Math.ceil(filteredStrikes.length / 30)
      yAxisG.selectAll('.tick text').attr('display', (_, i) => i % step === 0 ? null : 'none')
    }

    const xAxis = d3.axisBottom(xScale).ticks(6).tickFormat(d => formatBillions(d as number))
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    styleAxis(xAxisG)

    // X-axis label
    g.append('text')
      .attr('x', width / 2).attr('y', height + 36)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans)
      .style('font-size', '11px')
      .text(showAbsoluteGEX ? 'Gamma (Calls → | ← Puts)' : 'Net Gamma')

    // Title
    g.append('text')
      .attr('x', width / 2).attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '13px')
      .style('font-weight', '700')
      .text(`${ticker} ${showAbsoluteGEX ? 'Absolute' : 'Net'} Gamma by Strike (${selectedExpiryLabel})`)

    // Hover interactions
    const hoverLine = g.append('line')
      .attr('stroke', '#444').attr('stroke-width', 1).attr('stroke-dasharray', '3,3')
      .attr('x1', 0).attr('x2', width).attr('y1', 0).attr('y2', 0)
      .style('opacity', 0).style('pointer-events', 'none')

    g.append('rect')
      .attr('width', width).attr('height', height)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent) => {
        const [, my] = d3.pointer(event)
        const bandStep = yScale.step()
        const idx = Math.floor(my / bandStep)
        if (idx < 0 || idx >= filteredStrikes.length) return

        hoverLine
          .attr('y1', yScale(String(filteredStrikes[idx]))! + yScale.bandwidth() / 2)
          .attr('y2', yScale(String(filteredStrikes[idx]))! + yScale.bandwidth() / 2)
          .style('opacity', 1)

        if (tooltipRef.current && containerRef.current) {
          const strike = filteredStrikes[idx]
          const value = showAbsoluteGEX
            ? `Call: ${callGEX[idx].toFixed(3)}B | Put: ${Math.abs(putGEX[idx]).toFixed(3)}B`
            : `Net GEX: ${gammaValues[idx] >= 0 ? '+' : ''}${gammaValues[idx].toFixed(3)}B`
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

  }, [filteredStrikes, gammaValues, callGEX, putGEX, showAbsoluteGEX, dims, showVolumeChart, spotPrice, zeroGammaLevel, ticker, selectedExpiryLabel, allStrikes])

  // ─── D3 Volume Chart ─────────────────────────────────────────
  useEffect(() => {
    if (!volSvgRef.current || !showVolumeChart || filteredStrikes.length === 0) return

    const chartWidth = dims.width / 2 - 8
    const margin = HORIZONTAL_MARGINS
    const width = chartWidth - margin.left - margin.right
    const height = dims.height - margin.top - margin.bottom
    if (width <= 0 || height <= 0) return

    const svg = d3.select(volSvgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', chartWidth).attr('height', dims.height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const yScale = d3.scaleBand()
      .domain([...filteredStrikes].reverse().map(String))
      .range([0, height])
      .padding(0.15)

    const maxVol = (d3.max(volumeValues) || 1) * 1.1
    const xScale = d3.scaleLinear().domain([0, maxVol]).range([0, width])

    // Grid
    drawGridLinesX(g, xScale, height, 6)

    // Bars
    g.selectAll('.bar-vol')
      .data(filteredStrikes)
      .join('rect')
      .attr('class', 'bar-vol')
      .attr('y', (_, i) => yScale(String(filteredStrikes[i]))!)
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
    styleAxis(yAxisG, { fontSize: filteredStrikes.length > 40 ? 8 : 10 })
    if (filteredStrikes.length > 30) {
      const step = Math.ceil(filteredStrikes.length / 30)
      yAxisG.selectAll('.tick text').attr('display', (_, i) => i % step === 0 ? null : 'none')
    }

    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d => formatCompact(d as number))
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    styleAxis(xAxisG)

    g.append('text')
      .attr('x', width / 2).attr('y', height + 36)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans)
      .style('font-size', '11px')
      .text('Volume (Contracts)')

    g.append('text')
      .attr('x', width / 2).attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '13px')
      .style('font-weight', '700')
      .text(`${ticker} Volume by Strike`)

  }, [filteredStrikes, volumeValues, dims, showVolumeChart, ticker])

  // ─── Zoom controls ──────────────────────────────────────────
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
      
      {/* Charts */}
      <div className={`flex gap-4 w-full flex-1 min-h-0`}>
        <div className="flex-1 min-h-[300px]">
          <svg ref={svgRef} className="w-full h-full" />
        </div>
        {showVolumeChart && (
          <div className="flex-1 min-h-[300px]">
            <svg ref={volSvgRef} className="w-full h-full" />
          </div>
        )}
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
