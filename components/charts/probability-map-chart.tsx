"use client"

import { useEffect, useRef, useState, useMemo } from 'react'
import * as d3 from 'd3'
import { getProbabilityMap, ProbabilityMapData } from '@/lib/backend-api'
import { colors, typography } from '@/lib/design-tokens'
import { ExpectedMoveChart } from './expected-move-chart'
import type { OptionData } from '@/lib/types'

interface ProbabilityMapChartProps {
  ticker: string
  optionData: OptionData[]
  spotPrice: number
  futureExpiries: string[]
}

export function ProbabilityMapChart({ ticker, optionData, spotPrice, futureExpiries }: ProbabilityMapChartProps) {
  const [data, setData] = useState<ProbabilityMapData | null>(null)
  const [selectedExpiry, setSelectedExpiry] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refs for D3
  const svgRef2D = useRef<SVGSVGElement>(null)
  const svgRef3D = useRef<SVGSVGElement>(null)
  const containerRef2D = useRef<HTMLDivElement>(null)
  const containerRef3D = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [dims2D, setDims2D] = useState({ width: 400, height: 260 })
  const [dims3D, setDims3D] = useState({ width: 800, height: 400 })

  // Fetch full multi-expiry probability map data on mount or ticker change
  useEffect(() => {
    let active = true
    async function loadData() {
      setIsLoading(true)
      setError(null)
      try {
        const res = await getProbabilityMap(ticker)
        if (active) {
          if (res.success) {
            setData(res)
            // Default to closest expiry for the 2D curve
            if (res.availableExpiries && res.availableExpiries.length > 0) {
              setSelectedExpiry(res.availableExpiries[0])
            }
          } else {
            setError((res as any).error || 'Failed to load probability map')
          }
        }
      } catch (err: any) {
        if (active) setError(err.message || 'Failed to load probability map')
      } finally {
        if (active) setIsLoading(false)
      }
    }
    loadData()
    return () => {
      active = false
    }
  }, [ticker])

  // Resize Observers
  useEffect(() => {
    if (!containerRef2D.current) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setDims2D({ width, height })
        }
      }
    })
    observer.observe(containerRef2D.current)
    return () => observer.disconnect()
  }, [data])

  useEffect(() => {
    if (!containerRef3D.current) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setDims3D({ width, height })
        }
      }
    })
    observer.observe(containerRef3D.current)
    return () => observer.disconnect()
  }, [data])

  // Find active 2D PDF data based on dropdown selection
  const active2DPdf = useMemo(() => {
    if (!data || !data.expiries) return null
    return data.expiries.find(d => d.expiration === selectedExpiry) || data.expiries[0]
  }, [data, selectedExpiry])

  // ─── 1. RENDER D3 2D DENSITY CURVE (Top Right) ───
  useEffect(() => {
    if (!svgRef2D.current || !active2DPdf || !active2DPdf.pdf || active2DPdf.pdf.length === 0) return

    const margin = { top: 15, right: 15, bottom: 30, left: 45 }
    const width = dims2D.width - margin.left - margin.right
    const height = dims2D.height - margin.top - margin.bottom
    if (width <= 0 || height <= 0) return

    const svg = d3.select(svgRef2D.current)
    svg.selectAll('*').remove()
    svg.attr('width', dims2D.width).attr('height', dims2D.height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Scales
    const xMin = d3.min(active2DPdf.pdf, d => d.strike) || 0
    const xMax = d3.max(active2DPdf.pdf, d => d.strike) || 100
    const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, width])

    const yMax = d3.max(active2DPdf.pdf, d => d.density) || 0.01
    const yScale = d3.scaleLinear().domain([0, yMax * 1.1]).range([height, 0])

    // Area & Line Generators
    const area = d3.area<any>()
      .x(d => xScale(d.strike))
      .y0(height)
      .y1(d => yScale(d.density))
      .curve(d3.curveMonotoneX)

    const line = d3.line<any>()
      .x(d => xScale(d.strike))
      .y(d => yScale(d.density))
      .curve(d3.curveMonotoneX)

    // Gradient definitions
    const defs = svg.append('defs')
    const gradient = defs.append('linearGradient')
      .attr('id', 'pdf-gradient-2d')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%')

    gradient.append('stop').attr('offset', '0%').attr('stop-color', colors.accent.cyan).attr('stop-opacity', 0.45)
    gradient.append('stop').attr('offset', '100%').attr('stop-color', colors.accent.green).attr('stop-opacity', 0.01)

    // Grid lines (horizontal)
    g.selectAll('.grid-line')
      .data(yScale.ticks(4))
      .join('line')
      .attr('class', 'grid-line')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#131316')
      .attr('stroke-width', 0.8)

    // Area Draw
    g.append('path')
      .datum(active2DPdf.pdf)
      .attr('d', area)
      .attr('fill', 'url(#pdf-gradient-2d)')

    // Curve Line Draw
    g.append('path')
      .datum(active2DPdf.pdf)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', colors.accent.cyan)
      .attr('stroke-width', 1.5)

    // Spot Price reference line (Amber)
    const spotX = xScale(data.spotPrice)
    if (spotX >= 0 && spotX <= width) {
      g.append('line')
        .attr('x1', spotX).attr('x2', spotX)
        .attr('y1', 0).attr('y2', height)
        .attr('stroke', colors.accent.amber)
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '3, 3')

      g.append('text')
        .attr('x', spotX + 5)
        .attr('y', 12)
        .attr('fill', colors.accent.amber)
        .style('font-family', typography.fontMono)
        .style('font-size', '9px')
        .style('font-weight', '600')
        .text(`SPOT: ${data.spotPrice.toFixed(1)}`)
    }

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d => d.toString())
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    xAxisG.select('.domain').attr('stroke', '#1A1A1E')
    xAxisG.selectAll('.tick text')
      .attr('fill', colors.text.muted)
      .style('font-family', typography.fontMono)
      .style('font-size', '9px')
    xAxisG.selectAll('.tick line').attr('stroke', '#1A1A1E')

    const yAxis = d3.axisLeft(yScale).ticks(4).tickFormat(d3.format('.4f'))
    const yAxisG = g.append('g').call(yAxis)
    yAxisG.select('.domain').attr('stroke', '#1A1A1E')
    yAxisG.selectAll('.tick text')
      .attr('fill', colors.text.muted)
      .style('font-family', typography.fontMono)
      .style('font-size', '9px')
    yAxisG.selectAll('.tick line').attr('stroke', '#1A1A1E')

  }, [active2DPdf, dims2D, data])

  // ─── 2. RENDER D3 3D HEATMAP DIFFUSION CONE (Bottom) ───
  useEffect(() => {
    if (!svgRef3D.current || !data || !data.expiries || data.expiries.length === 0) return

    const margin = { top: 15, right: 20, bottom: 40, left: 55 }
    const width = dims3D.width - margin.left - margin.right
    const height = dims3D.height - margin.top - margin.bottom
    if (width <= 0 || height <= 0) return

    const svg = d3.select(svgRef3D.current)
    svg.selectAll('*').remove()
    svg.attr('width', dims3D.width).attr('height', dims3D.height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Sort expiries chronologically
    const sortedExpiries = [...data.expiries].sort((a, b) => a.daysToExpiry - b.daysToExpiry)

    // Scales
    const xScale = d3.scaleBand()
      .domain(sortedExpiries.map(d => d.expiration))
      .range([0, width])
      .padding(0.04)

    // Y scale matches Stock Price offset %: spanning -40% to +30%
    const yScale = d3.scaleLinear()
      .domain([-40, 30])
      .range([height, 0])

    // Build flat array of cells for D3 rendering
    const cells: any[] = []
    sortedExpiries.forEach(exp => {
      const maxDensity = d3.max(exp.pdf, p => p.density) || 1
      exp.pdf.forEach(p => {
        // filter strikes to fit within the -40% to +30% domain
        if (p.pctOffset >= -40 && p.pctOffset <= 30) {
          cells.push({
            expiry: exp.expiration,
            dte: exp.daysToExpiry,
            pctOffset: p.pctOffset,
            strike: p.strike,
            density: p.density,
            normalizedDensity: maxDensity > 0 ? p.density / maxDensity : 0
          })
        }
      })
    })

    // Sequential color scale matching "Inferno" (purple -> orange -> yellow/white)
    const colorScale = d3.scaleSequential(d3.interpolateInferno)
      .domain([0, 1]) // relative normalized peak density

    // Height of each rect in the column (120 points mapped to height)
    const cellHeight = Math.max(1, (height / 120))

    // Draw Heatmap cells
    g.selectAll('.cell')
      .data(cells)
      .join('rect')
      .attr('class', 'cell')
      .attr('x', d => xScale(d.expiry)!)
      .attr('y', d => yScale(d.pctOffset) - cellHeight)
      .attr('width', xScale.bandwidth())
      .attr('height', cellHeight + 0.6) // slight overlap to remove black pixel rows
      .attr('fill', d => colorScale(d.normalizedDensity))
      .on('mousemove', (event, d) => {
        if (!tooltipRef.current || !containerRef3D.current) return
        const containerRect = containerRef3D.current.getBoundingClientRect()
        
        tooltipRef.current.innerHTML = `
          <div style="font-family:${typography.fontSans};font-size:11px;color:${colors.text.primary};font-weight:600">
            ${new Date(d.expiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} (${d.dte} DTE)
          </div>
          <div style="font-family:${typography.fontMono};font-size:10px;color:${colors.accent.amber};margin-top:3px">
            Strike Level: $${d.strike.toFixed(1)} (${d.pctOffset >= 0 ? '+' : ''}${d.pctOffset.toFixed(1)}%)
          </div>
          <div style="font-family:${typography.fontMono};font-size:10px;color:${colors.accent.cyan}">
            Relative Prob: ${(d.normalizedDensity * 100).toFixed(0)}%
          </div>
        `
        tooltipRef.current.style.opacity = '1'
        tooltipRef.current.style.left = `${event.clientX - containerRect.left + 15}px`
        tooltipRef.current.style.top = `${event.clientY - containerRect.top - 45}px`
      })
      .on('mouseleave', () => {
        if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
      })

    // Dotted Spot Line in the center (0% offset)
    const spotY = yScale(0)
    if (spotY >= 0 && spotY <= height) {
      g.append('line')
        .attr('x1', 0).attr('x2', width)
        .attr('y1', spotY).attr('y2', spotY)
        .attr('stroke', '#FFFFFF')
        .attr('stroke-width', 0.8)
        .attr('stroke-dasharray', '3, 3')
        .style('opacity', 0.4)

      g.append('text')
        .attr('x', 6)
        .attr('y', spotY - 4)
        .attr('fill', '#FFFFFF')
        .style('font-family', typography.fontMono)
        .style('font-size', '8px')
        .style('opacity', 0.5)
        .text('SPOT REFERENCE')
    }

    // Axes
    const xAxis = d3.axisBottom(xScale).tickFormat(d => {
      const date = new Date(d)
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    })
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    xAxisG.select('.domain').attr('stroke', '#1A1A1E')
    xAxisG.selectAll('.tick text')
      .attr('fill', colors.text.muted)
      .style('font-family', typography.fontMono)
      .style('font-size', '8.5px')
      .attr('transform', 'rotate(-15)')
      .attr('text-anchor', 'end')
    xAxisG.selectAll('.tick line').attr('stroke', '#1A1A1E')

    const yAxis = d3.axisLeft(yScale).tickValues([-40, -25, -10, 0, 15, 30]).tickFormat(d => {
      if (d === 0) return 'SPOT'
      return `${d >= 0 ? '+' : ''}${d}%`
    })
    const yAxisG = g.append('g').call(yAxis)
    yAxisG.select('.domain').attr('stroke', '#1A1A1E')
    yAxisG.selectAll('.tick text')
      .attr('fill', colors.text.muted)
      .style('font-family', typography.fontMono)
      .style('font-size', '9px')
    yAxisG.selectAll('.tick line').attr('stroke', '#1A1A1E')

  }, [data, dims3D])

  // Format available expiry dates for select dropdown
  const dropdownExpiries = useMemo(() => {
    if (!data || !data.availableExpiries) return []
    return data.availableExpiries.map(exp => ({
      value: exp,
      label: new Date(exp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC'
      })
    }))
  }, [data])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#020203] p-4 text-[#D4D4D8] font-mono gap-4 overflow-y-auto terminal-scrollbar">
      {/* Top 2 charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-shrink-0">
        
        {/* Top Left: Implied Expected Move Line Chart */}
        <div className="bg-[#070709] border border-[#141416] rounded-lg p-4 flex flex-col gap-3 h-[380px] min-w-0">
          <div className="flex justify-between items-start border-b border-[#141416] pb-2 flex-shrink-0">
            <div>
              <h2 className="text-xs font-mono font-bold text-[#E5E5E5] tracking-wider uppercase">Implied Expected Move Curve</h2>
              <p className="text-[9px] text-[#555] mt-0.5">Strangle boundaries (16-Delta) over options term structure</p>
            </div>
            <span className="text-[9px] text-terminal-green uppercase border border-terminal-green/20 bg-terminal-green/5 px-2 py-0.5 rounded">All Expiries</span>
          </div>
          <div className="flex-1 min-h-0 relative">
            <ExpectedMoveChart
              data={optionData}
              ticker={ticker}
              spotPrice={spotPrice}
              selectedExpiry="All Dates"
            />
          </div>
        </div>

        {/* Top Right: 2D Implied Probability Density Curve */}
        <div className="bg-[#070709] border border-[#141416] rounded-lg p-4 flex flex-col gap-3 h-[380px] min-w-0">
          <div className="flex justify-between items-start border-b border-[#141416] pb-2 flex-shrink-0">
            <div>
              <h2 className="text-xs font-mono font-bold text-[#E5E5E5] tracking-wider uppercase">Implied Density Curve PDF ($f(K)$)</h2>
              <p className="text-[9px] text-[#555] mt-0.5">Breeden-Litzenberger Risk-Neutral Probability distribution</p>
            </div>
            {dropdownExpiries.length > 0 && (
              <select
                value={selectedExpiry}
                onChange={(e) => setSelectedExpiry(e.target.value)}
                className="bg-black border border-[#1A1A1E] text-[10px] font-mono text-[#E5E5E5] rounded px-2 py-0.5 focus:outline-none focus:border-[#444]"
              >
                {dropdownExpiries.map(exp => (
                  <option key={exp.value} value={exp.value}>{exp.label}</option>
                ))}
              </select>
            )}
          </div>

          {isLoading && !data && (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-2 text-terminal-green text-[10px]">
                <div className="w-3 h-3 border border-transparent border-t-terminal-green rounded-full animate-spin" />
                <span>SOLVING INTEGRAL MATRICES...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex-1 flex items-center justify-center text-[10px] text-[#FF3B60]">
              ⚠️ ERROR: {error}
            </div>
          )}

          {data && active2DPdf && (
            <div className="flex-1 flex flex-col min-h-0 gap-3">
              {/* Micro-Moments Board */}
              <div className="grid grid-cols-4 gap-2 flex-shrink-0 text-[9px]">
                <div className="bg-[#0A0A0C] border border-[#141416] rounded p-1.5 px-2">
                  <span className="block text-[#555] uppercase text-[7px]">E(S) Mean</span>
                  <span className="font-bold text-[#E5E5E5] block mt-0.5">${active2DPdf.mean.toFixed(1)}</span>
                </div>
                <div className="bg-[#0A0A0C] border border-[#141416] rounded p-1.5 px-2">
                  <span className="block text-[#555] uppercase text-[7px]">Implied Vol</span>
                  <span className="font-bold text-[#E5E5E5] block mt-0.5">±${active2DPdf.stdDev.toFixed(1)}</span>
                </div>
                <div className="bg-[#0A0A0C] border border-[#141416] rounded p-1.5 px-2">
                  <span className="block text-[#555] uppercase text-[7px]">Skewness</span>
                  <span className={`font-bold block mt-0.5 ${active2DPdf.skewness < 0 ? 'text-[#FF3B60]' : 'text-[#00C805]'}`}>
                    {active2DPdf.skewness.toFixed(3)}
                  </span>
                </div>
                <div className="bg-[#0A0A0C] border border-[#141416] rounded p-1.5 px-2">
                  <span className="block text-[#555] uppercase text-[7px]">Kurtosis</span>
                  <span className="font-bold text-[#E5E5E5] block mt-0.5">{active2DPdf.kurtosis.toFixed(3)}</span>
                </div>
              </div>

              {/* Chart container */}
              <div ref={containerRef2D} className="flex-1 min-h-0 relative">
                <svg ref={svgRef2D} className="w-full h-full" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: 3D Probability Map Diffusion Heatmap (Full Width) */}
      <div className="bg-[#070709] border border-[#141416] rounded-lg p-4 flex flex-col gap-3 h-[480px] flex-shrink-0 relative">
        <div className="flex justify-between items-start border-b border-[#141416] pb-2 flex-shrink-0">
          <div>
            <h2 className="text-xs font-mono font-bold text-[#E5E5E5] tracking-wider uppercase">3D Implied Probability Diffusion Map (Measure Q)</h2>
            <p className="text-[9px] text-[#555] mt-0.5">Chronological maturity horizon (X) vs spot price percentage offset (Y)</p>
          </div>
          <span className="text-[8px] text-[#555] font-mono uppercase bg-[#141416] px-1.5 py-0.5 rounded">Heat diffusion signature</span>
        </div>

        {isLoading && !data && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-2 text-terminal-green text-[10px]">
              <div className="w-3 h-3 border border-transparent border-t-terminal-green rounded-full animate-spin" />
              <span>GENERATING HEAT PROFILES...</span>
            </div>
          </div>
        )}

        {data && (
          <div ref={containerRef3D} className="flex-1 min-h-0 relative">
            <svg ref={svgRef3D} className="w-full h-full" />
            
            {/* Sync Tooltip */}
            <div
              ref={tooltipRef}
              className="absolute pointer-events-none opacity-0 bg-[#0F0F12]/95 border border-[#222]/85 px-3 py-2 rounded text-[#D4D4D8] z-30 shadow-2xl transition-opacity duration-100"
              style={{ width: "max-content" }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
