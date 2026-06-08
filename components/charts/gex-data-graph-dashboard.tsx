"use client"

import React, { useMemo, useRef, useEffect, useState } from "react"
import * as d3 from "d3"
import type { OptionData } from "@/lib/types"
import { colors, typography } from "@/lib/design-tokens"
import { styleAxis, drawGridLinesY, formatCompact, DEFAULT_MARGINS } from "@/lib/d3-helpers"

interface GEXDataGraphDashboardProps {
  data: OptionData[]
}

export const GEXDataGraphDashboard: React.FC<GEXDataGraphDashboardProps> = ({ data }) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 800, height: 400 })

  const chartData = useMemo(() => {
    const grouped: Record<string, { totalGamma: number; netGamma: number }> = {}
    data.forEach((o) => {
      const dateKey = new Date(o.expiration).toISOString().split("T")[0]
      if (!grouped[dateKey]) grouped[dateKey] = { totalGamma: 0, netGamma: 0 }
      const oi = o.open_interest || 0
      const gammaValue = typeof o.gamma === "number" ? o.gamma * oi * 100 : 0
      grouped[dateKey].totalGamma += gammaValue
      grouped[dateKey].netGamma += o.type === "C" ? gammaValue : -gammaValue
    })
    return Object.entries(grouped)
      .map(([date, { totalGamma, netGamma }]) => ({ date, totalGamma, netGamma }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [data])

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
    const xScale = d3.scalePoint()
      .domain(chartData.map(d => d.date))
      .range([0, width])
      .padding(0.5)

    const allValues = chartData.flatMap(d => [d.totalGamma, d.netGamma])
    const yExtent = d3.extent(allValues) as [number, number]
    const yPadding = (yExtent[1] - yExtent[0]) * 0.1 || 1
    const yScale = d3.scaleLinear()
      .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
      .range([height, 0])

    // Grid
    drawGridLinesY(g, yScale, width, 6)

    // Zero line
    if (yExtent[0] < 0 && yExtent[1] > 0) {
      g.append('line')
        .attr('x1', 0).attr('x2', width)
        .attr('y1', yScale(0)).attr('y2', yScale(0))
        .attr('stroke', '#2A2A2A').attr('stroke-width', 1)
    }

    // Total Gamma line
    const totalLine = d3.line<typeof chartData[0]>()
      .x(d => xScale(d.date)!)
      .y(d => yScale(d.totalGamma))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(chartData)
      .attr('d', totalLine)
      .attr('fill', 'none')
      .attr('stroke', colors.accent.purple)
      .attr('stroke-width', 2)

    // Net Gamma line
    const netLine = d3.line<typeof chartData[0]>()
      .x(d => xScale(d.date)!)
      .y(d => yScale(d.netGamma))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(chartData)
      .attr('d', netLine)
      .attr('fill', 'none')
      .attr('stroke', colors.accent.green)
      .attr('stroke-width', 2)

    // Hover crosshair
    const crosshairGroup = g.append('g').style('display', 'none')
    crosshairGroup.append('line')
      .attr('class', 'ch-v')
      .attr('y1', 0).attr('y2', height)
      .attr('stroke', '#444').attr('stroke-width', 0.5).attr('stroke-dasharray', '3,3')

    g.append('rect')
      .attr('width', width).attr('height', height)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event)
        // Find closest data point
        const domain = xScale.domain()
        let closestIdx = 0
        let closestDist = Infinity
        domain.forEach((d, i) => {
          const dist = Math.abs(xScale(d)! - mx)
          if (dist < closestDist) {
            closestDist = dist
            closestIdx = i
          }
        })

        const d = chartData[closestIdx]
        if (!d) return

        crosshairGroup.style('display', null)
        crosshairGroup.select('.ch-v')
          .attr('x1', xScale(d.date)!).attr('x2', xScale(d.date)!)

        if (tooltipRef.current && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect()
          tooltipRef.current.innerHTML = `
            <div style="font-family:${typography.fontSans};font-size:12px;color:${colors.text.primary};font-weight:600">${d.date}</div>
            <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.accent.purple};margin-top:2px">
              Total Γ: ${formatCompact(d.totalGamma)}
            </div>
            <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.accent.green}">
              Net Γ: ${formatCompact(d.netGamma)}
            </div>
          `
          tooltipRef.current.style.opacity = '1'
          tooltipRef.current.style.left = `${event.clientX - rect.left + 14}px`
          tooltipRef.current.style.top = `${event.clientY - rect.top - 30}px`
        }
      })
      .on('mouseleave', () => {
        crosshairGroup.style('display', 'none')
        if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
      })

    // Axes
    const xAxis = d3.axisBottom(xScale).tickSize(0)
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    styleAxis(xAxisG)
    xAxisG.selectAll('.tick text').attr('transform', 'rotate(-45)').attr('text-anchor', 'end')
    if (chartData.length > 20) {
      const step = Math.ceil(chartData.length / 20)
      xAxisG.selectAll('.tick text').attr('display', (_, i) => i % step === 0 ? null : 'none')
    }

    const yAxis = d3.axisLeft(yScale).ticks(6).tickFormat(d => formatCompact(d as number))
    const yAxisG = g.append('g').call(yAxis)
    styleAxis(yAxisG)

    // Title
    g.append('text')
      .attr('x', width / 2).attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '13px')
      .style('font-weight', '700')
      .text('Total & Net Gamma by Expiration')

    // Legend
    const legend = g.append('g').attr('transform', `translate(${width - 200}, -12)`)
    legend.append('line').attr('x1', 0).attr('x2', 16).attr('y1', 5).attr('y2', 5).attr('stroke', colors.accent.purple).attr('stroke-width', 2)
    legend.append('text').attr('x', 20).attr('y', 9).attr('fill', colors.text.secondary).style('font-family', typography.fontSans).style('font-size', '10px').text('Total Gamma')
    legend.append('line').attr('x1', 100).attr('x2', 116).attr('y1', 5).attr('y2', 5).attr('stroke', colors.accent.green).attr('stroke-width', 2)
    legend.append('text').attr('x', 120).attr('y', 9).attr('fill', colors.text.secondary).style('font-family', typography.fontSans).style('font-size', '10px').text('Net Gamma')

  }, [chartData, dims])

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
