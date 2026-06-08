"use client"

import { useMemo, useRef, useEffect, useState } from "react"
import * as d3 from "d3"
import type { OptionData } from "@/lib/types"
import { calculateExpectedMove } from "@/lib/calculations"
import { colors, typography } from "@/lib/design-tokens"
import { styleAxis, drawGridLinesY, DEFAULT_MARGINS } from "@/lib/d3-helpers"

interface ExpectedMoveChartProps {
  data: OptionData[]
  ticker: string
  spotPrice: number
  selectedExpiry: string
}

export function ExpectedMoveChart({ data, ticker, spotPrice, selectedExpiry }: ExpectedMoveChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 800, height: 400 })

  const chartData = useMemo(() => {
    const selectedDate = selectedExpiry !== "All Dates" ? new Date(selectedExpiry + "T00:00:00Z") : undefined
    const moves = calculateExpectedMove(data, spotPrice, selectedDate)
    return moves.map(move => ({
      date: move.date,
      upper: move.upper,
      lower: move.lower,
      upperPct: move.upperPct,
      lowerPct: move.lowerPct,
    }))
  }, [data, spotPrice, selectedExpiry])

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
    if (!svgRef.current || chartData.length === 0) return

    const margin = { ...DEFAULT_MARGINS, bottom: 56 }
    const width = dims.width - margin.left - margin.right
    const height = dims.height - margin.top - margin.bottom
    if (width <= 0 || height <= 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', dims.width).attr('height', dims.height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Scales
    const xScale = d3.scaleTime()
      .domain(d3.extent(chartData, d => d.date) as [Date, Date])
      .range([0, width])

    const allPrices = chartData.flatMap(d => [d.upper, d.lower, spotPrice])
    const yExtent = d3.extent(allPrices) as [number, number]
    const yPadding = (yExtent[1] - yExtent[0]) * 0.1
    const yScale = d3.scaleLinear()
      .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
      .range([height, 0])

    // Grid
    drawGridLinesY(g, yScale, width, 6)

    // Area between upper and lower (shaded range)
    const area = d3.area<typeof chartData[0]>()
      .x(d => xScale(d.date))
      .y0(d => yScale(d.lower))
      .y1(d => yScale(d.upper))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(chartData)
      .attr('d', area)
      .attr('fill', 'rgba(139, 92, 246, 0.08)')
      .attr('stroke', 'none')

    // Lines
    const lineUpper = d3.line<typeof chartData[0]>()
      .x(d => xScale(d.date))
      .y(d => yScale(d.upper))
      .curve(d3.curveMonotoneX)

    const lineLower = d3.line<typeof chartData[0]>()
      .x(d => xScale(d.date))
      .y(d => yScale(d.lower))
      .curve(d3.curveMonotoneX)

    // Upper bound line
    g.append('path')
      .datum(chartData)
      .attr('d', lineUpper)
      .attr('fill', 'none')
      .attr('stroke', colors.accent.green)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,3')

    // Lower bound line
    g.append('path')
      .datum(chartData)
      .attr('d', lineLower)
      .attr('fill', 'none')
      .attr('stroke', colors.accent.red)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,3')

    // Spot price reference line
    g.append('line')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', yScale(spotPrice)).attr('y2', yScale(spotPrice))
      .attr('stroke', colors.accent.amber)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6,4')

    g.append('text')
      .attr('x', width - 4).attr('y', yScale(spotPrice) - 6)
      .attr('text-anchor', 'end')
      .attr('fill', colors.accent.amber)
      .style('font-family', typography.fontMono).style('font-size', '9px').style('font-weight', '600')
      .text(`SPOT ${spotPrice.toFixed(0)}`)

    // Data points - Upper
    g.selectAll('.dot-upper')
      .data(chartData)
      .join('circle')
      .attr('class', 'dot-upper')
      .attr('cx', d => xScale(d.date))
      .attr('cy', d => yScale(d.upper))
      .attr('r', 4)
      .attr('fill', colors.accent.green)
      .attr('stroke', '#0A0A0A')
      .attr('stroke-width', 1.5)

    // Data points - Lower
    g.selectAll('.dot-lower')
      .data(chartData)
      .join('circle')
      .attr('class', 'dot-lower')
      .attr('cx', d => xScale(d.date))
      .attr('cy', d => yScale(d.lower))
      .attr('r', 4)
      .attr('fill', colors.accent.red)
      .attr('stroke', '#0A0A0A')
      .attr('stroke-width', 1.5)

    // Hover interaction
    const bisect = d3.bisector<typeof chartData[0], Date>(d => d.date).left

    g.append('rect')
      .attr('width', width).attr('height', height)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event)
        const x0 = xScale.invert(mx)
        const idx = bisect(chartData, x0, 1)
        const d0 = chartData[idx - 1]
        const d1 = chartData[idx]
        const d = d1 && (x0.getTime() - d0.date.getTime() > d1.date.getTime() - x0.getTime()) ? d1 : d0
        if (!d || !tooltipRef.current || !containerRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        tooltipRef.current.innerHTML = `
          <div style="font-family:${typography.fontSans};font-size:12px;color:${colors.text.primary};font-weight:600">
            ${d.date.toLocaleDateString('en-CA')}
          </div>
          <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.accent.green};margin-top:2px">
            Upper: ${d.upper.toFixed(2)} (${d.upperPct > 0 ? '+' : ''}${d.upperPct}%)
          </div>
          <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.accent.red}">
            Lower: ${d.lower.toFixed(2)} (${d.lowerPct > 0 ? '+' : ''}${d.lowerPct}%)
          </div>
          <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.accent.amber};margin-top:2px">
            Spot: ${spotPrice.toFixed(2)}
          </div>
        `
        tooltipRef.current.style.opacity = '1'
        tooltipRef.current.style.left = `${event.clientX - rect.left + 14}px`
        tooltipRef.current.style.top = `${event.clientY - rect.top - 40}px`
      })
      .on('mouseleave', () => {
        if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
      })

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(6).tickFormat(d => d3.timeFormat('%b %d')(d as Date))
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    styleAxis(xAxisG)
    xAxisG.selectAll('.tick text').attr('transform', 'rotate(-45)').attr('text-anchor', 'end')

    const yAxis = d3.axisLeft(yScale).ticks(6)
    const yAxisG = g.append('g').call(yAxis)
    styleAxis(yAxisG)

    // Labels
    g.append('text')
      .attr('x', width / 2).attr('y', height + 48)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans).style('font-size', '11px')
      .text('Expiration Date')

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -height / 2).attr('y', -50)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans).style('font-size', '11px')
      .text('Strike Price')

    g.append('text')
      .attr('x', width / 2).attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '13px')
      .style('font-weight', '700')
      .text(`${ticker} Expected Move${selectedExpiry !== "All Dates" ? ` (${selectedExpiry})` : " (All Expiries)"}`)

    // Legend
    const legend = g.append('g').attr('transform', `translate(${width - 300}, -12)`)
    // Spot
    legend.append('line').attr('x1', 0).attr('x2', 16).attr('y1', 5).attr('y2', 5).attr('stroke', colors.accent.amber).attr('stroke-width', 1.5).attr('stroke-dasharray', '5,5')
    legend.append('text').attr('x', 20).attr('y', 9).attr('fill', colors.text.secondary).style('font-family', typography.fontSans).style('font-size', '10px').text('Current Price')
    // Upper
    legend.append('line').attr('x1', 105).attr('x2', 121).attr('y1', 5).attr('y2', 5).attr('stroke', colors.accent.green).attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3')
    legend.append('text').attr('x', 125).attr('y', 9).attr('fill', colors.text.secondary).style('font-family', typography.fontSans).style('font-size', '10px').text('Upper (16Δ)')
    // Lower
    legend.append('line').attr('x1', 200).attr('x2', 216).attr('y1', 5).attr('y2', 5).attr('stroke', colors.accent.red).attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3')
    legend.append('text').attr('x', 220).attr('y', 9).attr('fill', colors.text.secondary).style('font-family', typography.fontSans).style('font-size', '10px').text('Lower (16Δ)')

  }, [chartData, dims, ticker, spotPrice, selectedExpiry])

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg ref={svgRef} className="w-full h-full" />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none z-50 px-3 py-2 rounded border transition-opacity duration-100"
        style={{ opacity: 0, backgroundColor: '#111111', borderColor: '#1A1A1A' }}
      />
    </div>
  )
}
