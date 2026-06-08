"use client"

import { useMemo, useRef, useEffect, useState } from "react"
import * as d3 from "d3"
import type { OptionData } from "@/lib/types"
import { computeGEXByExpiration } from "@/lib/calculations"
import { colors, typography } from "@/lib/design-tokens"
import {
  styleAxis,
  drawGridLinesY,
  formatBillions,
  DEFAULT_MARGINS,
} from "@/lib/d3-helpers"

interface GEXByExpirationChartProps {
  data: OptionData[]
  ticker: string
  selectedExpiries: string[]
}

export function GEXByExpirationChart({ data, ticker, selectedExpiries }: GEXByExpirationChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 800, height: 400 })

  // Filter data by selected expiries
  const filteredData = useMemo(() => {
    if (selectedExpiries.length === 0) return data
    return data.filter(o => selectedExpiries.includes(o.expiration.toISOString().split("T")[0]))
  }, [data, selectedExpiries])

  const chartData = useMemo(() => {
    const gexByExpiration = computeGEXByExpiration(filteredData)
    return gexByExpiration.map(item => ({
      date: item.expiration,
      gex: item.gex,
    }))
  }, [filteredData])

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

    const margin = DEFAULT_MARGINS
    const width = dims.width - margin.left - margin.right
    const height = dims.height - margin.top - margin.bottom
    if (width <= 0 || height <= 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', dims.width).attr('height', dims.height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Scales
    const xScale = d3.scaleBand()
      .domain(chartData.map(d => d.date))
      .range([0, width])
      .padding(0.25)

    const yExtent = d3.extent(chartData, d => d.gex) as [number, number]
    const yMax = Math.max(Math.abs(yExtent[0] || 0), Math.abs(yExtent[1] || 0)) * 1.15
    const yScale = d3.scaleLinear().domain([-yMax, yMax]).range([height, 0])

    // Grid
    drawGridLinesY(g, yScale, width, 6)

    // Zero line
    g.append('line')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', yScale(0)).attr('y2', yScale(0))
      .attr('stroke', '#2A2A2A').attr('stroke-width', 1)

    // Bars
    g.selectAll('.bar')
      .data(chartData)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', d => xScale(d.date)!)
      .attr('y', d => d.gex >= 0 ? yScale(d.gex) : yScale(0))
      .attr('width', xScale.bandwidth())
      .attr('height', d => Math.abs(yScale(d.gex) - yScale(0)))
      .attr('fill', d => d.gex >= 0 ? colors.accentAlpha.green50 : colors.accentAlpha.red50)
      .attr('stroke', d => d.gex >= 0 ? colors.accent.green : colors.accent.red)
      .attr('stroke-width', 0.5)
      .attr('rx', 2)
      .on('mouseenter', (event: MouseEvent, d) => {
        if (!tooltipRef.current || !containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        tooltipRef.current.innerHTML = `
          <div style="font-family:${typography.fontSans};font-size:12px;color:${colors.text.primary};font-weight:600">${d.date}</div>
          <div style="font-family:${typography.fontMono};font-size:11px;color:${d.gex >= 0 ? colors.accent.green : colors.accent.red};margin-top:2px">
            GEX: ${d.gex >= 0 ? '+' : ''}${d.gex.toFixed(4)} Bn$
          </div>
        `
        tooltipRef.current.style.opacity = '1'
        tooltipRef.current.style.left = `${event.clientX - rect.left + 14}px`
        tooltipRef.current.style.top = `${event.clientY - rect.top - 20}px`
      })
      .on('mouseleave', () => {
        if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
      })

    // Axes
    const xAxis = d3.axisBottom(xScale).tickSize(0)
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    styleAxis(xAxisG)

    // Rotate labels if many
    if (chartData.length > 10) {
      xAxisG.selectAll('.tick text')
        .attr('transform', 'rotate(-45)')
        .attr('text-anchor', 'end')
        .attr('dx', '-0.5em')
        .attr('dy', '0.25em')
    }

    // Only show every Nth label if too dense
    if (chartData.length > 20) {
      const step = Math.ceil(chartData.length / 20)
      xAxisG.selectAll('.tick text').attr('display', (_, i) => i % step === 0 ? null : 'none')
    }

    const yAxis = d3.axisLeft(yScale).ticks(6).tickFormat(d => formatBillions(d as number))
    const yAxisG = g.append('g').call(yAxis)
    styleAxis(yAxisG)

    // Axis labels
    g.append('text')
      .attr('x', width / 2).attr('y', height + 40)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans)
      .style('font-size', '11px')
      .text('Expiration Date')

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -height / 2).attr('y', -50)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans)
      .style('font-size', '11px')
      .text('Gamma Exposure (Bn$ / %)')

    // Title
    g.append('text')
      .attr('x', width / 2).attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '13px')
      .style('font-weight', '700')
      .text(`${ticker} GEX by Expiration`)

  }, [chartData, dims, ticker])

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
