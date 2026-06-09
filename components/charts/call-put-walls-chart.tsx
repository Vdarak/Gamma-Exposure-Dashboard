"use client"

import { useMemo, useRef, useEffect, useState } from "react"
import * as d3 from "d3"
import type { OptionData } from "@/lib/types"
import { computeCallPutWalls } from "@/lib/calculations"
import { colors, typography } from "@/lib/design-tokens"
import { styleAxis, drawGridLinesY, formatCompact, DEFAULT_MARGINS } from "@/lib/d3-helpers"

interface CallPutWallsChartProps {
  data: OptionData[]
  ticker: string
  selectedExpiry: Date
}

export function CallPutWallsChart({ data, ticker, selectedExpiry }: CallPutWallsChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 800, height: 400 })

  const chartData = useMemo(() => {
    const walls = computeCallPutWalls(data, selectedExpiry)
    const allStrikes = new Set([...walls.callOI.map(i => i.strike), ...walls.putOI.map(i => i.strike)])
    const strikes = Array.from(allStrikes).sort((a, b) => a - b)
    const callData = strikes.map(s => walls.callOI.find(i => i.strike === s)?.oi || 0)
    const putData = strikes.map(s => walls.putOI.find(i => i.strike === s)?.oi || 0)
    return { strikes, callData, putData, walls }
  }, [data, selectedExpiry])

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

  // D3 render
  useEffect(() => {
    if (!svgRef.current || chartData.strikes.length === 0) return

    const margin = DEFAULT_MARGINS
    const width = dims.width - margin.left - margin.right
    const height = dims.height - margin.top - margin.bottom
    if (width <= 0 || height <= 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', dims.width).attr('height', dims.height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Scales
    const x0 = d3.scaleBand()
      .domain(chartData.strikes.map(String))
      .range([0, width])
      .padding(0.2)

    const x1 = d3.scaleBand()
      .domain(['calls', 'puts'])
      .range([0, x0.bandwidth()])
      .padding(0.05)

    const maxOI = Math.max(d3.max(chartData.callData) || 0, d3.max(chartData.putData) || 0) * 1.15
    const yScale = d3.scaleLinear().domain([0, maxOI]).range([height, 0])

    // Grid
    drawGridLinesY(g, yScale, width, 6)

    // Call bars
    g.selectAll('.bar-call')
      .data(chartData.strikes)
      .join('rect')
      .attr('class', 'bar-call')
      .attr('x', (_, i) => x0(String(chartData.strikes[i]))! + x1('calls')!)
      .attr('y', (_, i) => yScale(chartData.callData[i]))
      .attr('width', x1.bandwidth())
      .attr('height', (_, i) => height - yScale(chartData.callData[i]))
      .attr('fill', colors.accentAlpha.green50)
      .attr('stroke', colors.accent.green)
      .attr('stroke-width', 0.5)
      .attr('rx', 1)

    // Put bars
    g.selectAll('.bar-put')
      .data(chartData.strikes)
      .join('rect')
      .attr('class', 'bar-put')
      .attr('x', (_, i) => x0(String(chartData.strikes[i]))! + x1('puts')!)
      .attr('y', (_, i) => yScale(chartData.putData[i]))
      .attr('width', x1.bandwidth())
      .attr('height', (_, i) => height - yScale(chartData.putData[i]))
      .attr('fill', colors.accentAlpha.red50)
      .attr('stroke', colors.accent.red)
      .attr('stroke-width', 0.5)
      .attr('rx', 1)

    // Wall reference lines
    if (chartData.walls.callWall) {
      const cx = x0(String(chartData.walls.callWall))
      if (cx !== undefined) {
        g.append('line')
          .attr('x1', cx + x0.bandwidth() / 2).attr('x2', cx + x0.bandwidth() / 2)
          .attr('y1', 0).attr('y2', height)
          .attr('stroke', colors.accent.green)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '6,4')
          .attr('opacity', 0.7)
        g.append('text')
          .attr('x', cx + x0.bandwidth() / 2 + 4).attr('y', 12)
          .attr('fill', colors.accent.green)
          .style('font-family', typography.fontMono).style('font-size', '9px').style('font-weight', '600')
          .text(`CALL WALL ${chartData.walls.callWall}`)
      }
    }
    if (chartData.walls.putWall) {
      const px = x0(String(chartData.walls.putWall))
      if (px !== undefined) {
        g.append('line')
          .attr('x1', px + x0.bandwidth() / 2).attr('x2', px + x0.bandwidth() / 2)
          .attr('y1', 0).attr('y2', height)
          .attr('stroke', colors.accent.red)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '6,4')
          .attr('opacity', 0.7)
        g.append('text')
          .attr('x', px + x0.bandwidth() / 2 + 4).attr('y', 24)
          .attr('fill', colors.accent.red)
          .style('font-family', typography.fontMono).style('font-size', '9px').style('font-weight', '600')
          .text(`PUT WALL ${chartData.walls.putWall}`)
      }
    }

    // Hover overlay
    g.selectAll('.hover-zone')
      .data(chartData.strikes)
      .join('rect')
      .attr('class', 'hover-zone')
      .attr('x', (_, i) => x0(String(chartData.strikes[i]))!)
      .attr('y', 0)
      .attr('width', x0.bandwidth())
      .attr('height', height)
      .attr('fill', 'transparent')
      .on('mouseenter', (event: MouseEvent, _, ) => {
        const i = chartData.strikes.indexOf(_ as unknown as number)
        if (i < 0 || !tooltipRef.current || !containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        tooltipRef.current.innerHTML = `
          <div style="font-family:${typography.fontSans};font-size:12px;color:${colors.text.primary};font-weight:600">Strike ${chartData.strikes[i]}</div>
          <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.accent.green};margin-top:2px">Calls OI: ${chartData.callData[i].toLocaleString()}</div>
          <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.accent.red}">Puts OI: ${chartData.putData[i].toLocaleString()}</div>
        `
        tooltipRef.current.style.opacity = '1'
        tooltipRef.current.style.left = `${event.clientX - rect.left + 14}px`
        tooltipRef.current.style.top = `${event.clientY - rect.top - 30}px`
      })
      .on('mouseleave', () => {
        if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
      })

    // Axes
    const xAxis = d3.axisBottom(x0).tickSize(0)
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    styleAxis(xAxisG)
    if (chartData.strikes.length > 20) {
      const step = Math.ceil(chartData.strikes.length / 20)
      xAxisG.selectAll('.tick text').attr('display', (_, i) => i % step === 0 ? null : 'none')
    }

    const yAxis = d3.axisLeft(yScale).ticks(6).tickFormat(d => formatCompact(d as number))
    const yAxisG = g.append('g').call(yAxis)
    styleAxis(yAxisG)

    // Labels
    g.append('text')
      .attr('x', width / 2).attr('y', height + 40)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans).style('font-size', '11px')
      .text('Strike')

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -height / 2).attr('y', -50)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans).style('font-size', '11px')
      .text('Open Interest')

    g.append('text')
      .attr('x', width / 2).attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '13px')
      .style('font-weight', '700')
      .text(`${ticker} Call/Put Walls (${selectedExpiry.toISOString().split("T")[0]})`)

    // Legend
    const legend = g.append('g').attr('transform', `translate(${width - 140}, -12)`)
    legend.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', colors.accentAlpha.green50).attr('stroke', colors.accent.green).attr('stroke-width', 0.5)
    legend.append('text').attr('x', 14).attr('y', 9).attr('fill', colors.text.secondary).style('font-family', typography.fontSans).style('font-size', '10px').text('Calls OI')
    legend.append('rect').attr('x', 70).attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', colors.accentAlpha.red50).attr('stroke', colors.accent.red).attr('stroke-width', 0.5)
    legend.append('text').attr('x', 84).attr('y', 9).attr('fill', colors.text.secondary).style('font-family', typography.fontSans).style('font-size', '10px').text('Puts OI')

  }, [chartData, dims, ticker, selectedExpiry])

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg ref={svgRef} className="w-full h-full" />
      {/* Wall indicators */}
      <div className="absolute top-12 right-4 flex flex-col gap-1">
        {chartData.walls.callWall && (
          <div className="flex items-center gap-2 px-2 py-1 bg-[#0A0A0A] border border-[#1A1A1A] rounded">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors.accent.green }} />
            <span className="text-xxs font-mono text-[#B5B5B5]">
              Call Wall: <span className="text-terminal-green">{chartData.walls.callWall}</span>
            </span>
          </div>
        )}
        {chartData.walls.putWall && (
          <div className="flex items-center gap-2 px-2 py-1 bg-[#0A0A0A] border border-[#1A1A1A] rounded">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors.accent.red }} />
            <span className="text-xxs font-mono text-[#B5B5B5]">
              Put Wall: <span className="text-terminal-red">{chartData.walls.putWall}</span>
            </span>
          </div>
        )}
      </div>
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none z-50 px-3 py-2 rounded border transition-opacity duration-100"
        style={{ opacity: 0, backgroundColor: '#111111', borderColor: '#1A1A1A' }}
      />
    </div>
  )
}
