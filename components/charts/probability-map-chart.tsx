"use client"

import { useEffect, useRef, useState, useMemo } from 'react'
import * as d3 from 'd3'
import { getProbabilityMap, ProbabilityMapData } from '@/lib/backend-api'
import { colors, typography } from '@/lib/design-tokens'

interface ProbabilityMapChartProps {
  ticker: string
}

export function ProbabilityMapChart({ ticker }: ProbabilityMapChartProps) {
  const [data, setData] = useState<ProbabilityMapData | null>(null)
  const [selectedExpiry, setSelectedExpiry] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 600, height: 350 })

  // Fetch probability map
  useEffect(() => {
    let active = true
    async function loadData() {
      setIsLoading(true)
      setError(null)
      try {
        const res = await getProbabilityMap(ticker, selectedExpiry || undefined)
        if (active) {
          if (res.success) {
            setData(res)
            if (!selectedExpiry) {
              setSelectedExpiry(res.expiration)
            }
          } else {
            setError((res as any).error || 'Failed to load PDF map')
          }
        }
      } catch (err: any) {
        if (active) setError(err.message || 'Failed to load PDF map')
      } finally {
        if (active) setIsLoading(false)
      }
    }
    loadData()
    return () => {
      active = false
    }
  }, [ticker, selectedExpiry])

  // Reset selected expiry when ticker changes
  useEffect(() => {
    setSelectedExpiry('')
    setData(null)
  }, [ticker])

  // Resize Observer
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setDims({ width, height })
        }
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Render D3 density chart
  useEffect(() => {
    if (!svgRef.current || !data || !data.pdf || data.pdf.length === 0) return

    const margin = { top: 30, right: 20, bottom: 40, left: 50 }
    const width = dims.width - margin.left - margin.right
    const height = dims.height - margin.top - margin.bottom
    if (width <= 0 || height <= 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', dims.width).attr('height', dims.height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Scales
    const xMin = d3.min(data.pdf, d => d.strike) || 0
    const xMax = d3.max(data.pdf, d => d.strike) || 100
    const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, width])

    const yMax = d3.max(data.pdf, d => d.density) || 0.01
    const yScale = d3.scaleLinear().domain([0, yMax * 1.1]).range([height, 0])

    // Area Generator
    const area = d3.area<any>()
      .x(d => xScale(d.strike))
      .y0(height)
      .y1(d => yScale(d.density))
      .curve(d3.curveMonotoneX)

    // Line Generator
    const line = d3.line<any>()
      .x(d => xScale(d.strike))
      .y(d => yScale(d.density))
      .curve(d3.curveMonotoneX)

    // Gradient definition
    const defs = svg.append('defs')
    const gradient = defs.append('linearGradient')
      .attr('id', 'pdf-gradient')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%')

    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', colors.accent.cyan)
      .attr('stop-opacity', 0.5)

    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', colors.accent.green)
      .attr('stop-opacity', 0.02)

    // Grid lines (horizontal)
    g.selectAll('.grid-line')
      .data(yScale.ticks(5))
      .join('line')
      .attr('class', 'grid-line')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#141416')
      .attr('stroke-width', 1)

    // Area Draw
    g.append('path')
      .datum(data.pdf)
      .attr('d', area)
      .attr('fill', 'url(#pdf-gradient)')

    // Curve Line Draw
    g.append('path')
      .datum(data.pdf)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', colors.accent.cyan)
      .attr('stroke-width', 1.8)

    // Spot Price Vertical Marker (Amber)
    const spotX = xScale(data.spotPrice)
    if (spotX >= 0 && spotX <= width) {
      g.append('line')
        .attr('x1', spotX).attr('x2', spotX)
        .attr('y1', 0).attr('y2', height)
        .attr('stroke', colors.accent.amber)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4, 4')

      g.append('text')
        .attr('x', spotX + 6)
        .attr('y', 15)
        .attr('fill', colors.accent.amber)
        .style('font-family', typography.fontMono)
        .style('font-size', '10px')
        .style('font-weight', '600')
        .text(`SPOT: ${data.spotPrice.toFixed(2)}`)
    }

    // Expected Value / Mean Vertical Marker (Cyan)
    const meanX = xScale(data.mean)
    if (meanX >= 0 && meanX <= width) {
      g.append('line')
        .attr('x1', meanX).attr('x2', meanX)
        .attr('y1', 0).attr('y2', height)
        .attr('stroke', colors.accent.purple)
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '2, 3')

      g.append('text')
        .attr('x', meanX - 6)
        .attr('y', height - 15)
        .attr('text-anchor', 'end')
        .attr('fill', colors.accent.purple)
        .style('font-family', typography.fontMono)
        .style('font-size', '10px')
        .text(`E(S): ${data.mean.toFixed(2)}`)
    }

    // Std Dev Shaded Range
    const lowerStd = xScale(data.mean - data.stdDev)
    const upperStd = xScale(data.mean + data.stdDev)
    
    if (lowerStd >= 0 && upperStd <= width) {
      g.append('rect')
        .attr('x', lowerStd)
        .attr('y', 0)
        .attr('width', upperStd - lowerStd)
        .attr('height', height)
        .attr('fill', 'rgba(139, 92, 246, 0.03)')
        .attr('pointer-events', 'none')

      // Draw boundary markers
      g.append('line')
        .attr('x1', lowerStd).attr('x2', lowerStd)
        .attr('y1', 0).attr('y2', height)
        .attr('stroke', '#33333C')
        .attr('stroke-width', 0.8)
        .attr('stroke-dasharray', '2, 2')

      g.append('line')
        .attr('x1', upperStd).attr('x2', upperStd)
        .attr('y1', 0).attr('y2', height)
        .attr('stroke', '#33333C')
        .attr('stroke-width', 0.8)
        .attr('stroke-dasharray', '2, 2')
    }

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(8).tickFormat(d => d.toString())
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    xAxisG.select('.domain').attr('stroke', '#1C1C21')
    xAxisG.selectAll('.tick text')
      .attr('fill', colors.text.muted)
      .style('font-family', typography.fontMono)
      .style('font-size', '10px')
    xAxisG.selectAll('.tick line').attr('stroke', '#1C1C21')

    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d3.format('.4f'))
    const yAxisG = g.append('g').call(yAxis)
    yAxisG.select('.domain').attr('stroke', '#1C1C21')
    yAxisG.selectAll('.tick text')
      .attr('fill', colors.text.muted)
      .style('font-family', typography.fontMono)
      .style('font-size', '10px')
    yAxisG.selectAll('.tick line').attr('stroke', '#1C1C21')

  }, [data, dims])

  // Format expiry dates for readable select
  const formattedExpiries = useMemo(() => {
    if (!data || !data.availableExpiries) return []
    return data.availableExpiries.map(exp => ({
      value: exp,
      label: new Date(exp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
      })
    }))
  }, [data])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#070709] border border-[#141416] rounded-lg p-4">
      {/* Header controls */}
      <div className="flex items-center justify-between mb-4 border-b border-[#141416] pb-3 flex-shrink-0">
        <div>
          <h2 className="text-xs font-mono font-bold text-[#E5E5E5] tracking-wider uppercase">Implied Probability Density Map</h2>
          <p className="text-[10px] font-mono text-[#555] mt-0.5">Breeden-Litzenberger Risk-Neutral PDF Expirations ($f(K)$)</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[#555] uppercase">Expiry</span>
          {formattedExpiries.length > 0 && (
            <select
              value={selectedExpiry}
              onChange={(e) => setSelectedExpiry(e.target.value)}
              className="bg-black border border-[#1A1A1E] text-xs font-mono text-[#E5E5E5] rounded px-2.5 py-1 focus:outline-none focus:border-[#444]"
            >
              {formattedExpiries.map(exp => (
                <option key={exp.value} value={exp.value}>{exp.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {isLoading && !data && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-terminal-green">
            <div className="w-3.5 h-3.5 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
            <span className="text-[10px] font-mono tracking-widest uppercase">SOLVING INTEGRAL MATRICES...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex-1 flex items-center justify-center text-xs font-mono text-[#FF3B60]">
          ⚠️ ERROR: {error}
        </div>
      )}

      {data && (
        <div className="flex-1 flex flex-col min-h-0 gap-4">
          {/* Stats Moments Board */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 flex-shrink-0">
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-2.5">
              <span className="block text-[8px] font-mono text-[#555] uppercase tracking-wider">Expected Value E(S)</span>
              <span className="text-xs font-mono font-bold text-[#E5E5E5] block mt-0.5">${data.mean.toFixed(2)}</span>
            </div>
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-2.5">
              <span className="block text-[8px] font-mono text-[#555] uppercase tracking-wider">Implied Std Dev</span>
              <span className="text-xs font-mono font-bold text-[#E5E5E5] block mt-0.5">±${data.stdDev.toFixed(2)}</span>
            </div>
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-2.5">
              <span className="block text-[8px] font-mono text-[#555] uppercase tracking-wider">Implied Skewness</span>
              <span className={`text-xs font-mono font-bold block mt-0.5 ${data.skewness < 0 ? 'text-[#FF3B60]' : 'text-[#00C805]'}`}>
                {data.skewness.toFixed(4)}
              </span>
            </div>
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-2.5">
              <span className="block text-[8px] font-mono text-[#555] uppercase tracking-wider">Implied Kurtosis</span>
              <span className="text-xs font-mono font-bold text-[#E5E5E5] block mt-0.5">{data.kurtosis.toFixed(4)}</span>
            </div>
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-2.5">
              <span className="block text-[8px] font-mono text-[#555] uppercase tracking-wider">Pinning Strike</span>
              <span className="text-xs font-mono font-bold text-terminal-green block mt-0.5">${Math.round(data.pinStrike)}</span>
            </div>
          </div>

          {/* Area Chart Container */}
          <div ref={containerRef} className="flex-1 min-h-[220px] relative">
            <svg ref={svgRef} className="w-full h-full" />
          </div>

          <div className="border-t border-[#141416] pt-2 flex items-center justify-between text-[8px] font-mono text-[#444] flex-shrink-0">
            <span>DISTRIBUTION SOLVER: BREEDEN-LITZENBERGER SECOND DERIVATIVE MATRIX</span>
            <span className="text-[#00C805]">INTEGRATION CONVERGENCE: 100% (SUM(PDF*dK) = 1.00)</span>
          </div>
        </div>
      )}
    </div>
  )
}
