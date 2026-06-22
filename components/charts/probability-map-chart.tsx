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
  const densityScrollRef = useRef<HTMLDivElement>(null)

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
    const maxDte = d3.max(sortedExpiries, d => d.daysToExpiry) || 90

    // Grid dimension settings to ensure perfect squares that fill the container
    const numRows = 70
    const cellSize = height / numRows
    const numCols = Math.max(10, Math.floor(width / cellSize))
    const gridWidth = numCols * cellSize
    const xOffset = (width - gridWidth) / 2

    // Scales - Continuous Linear Scale for DTE, aligned to the square grid boundaries
    const xScale = d3.scaleLinear()
      .domain([0, maxDte])
      .range([xOffset, xOffset + gridWidth])

    // Y scale matches Stock Price offset %: spanning -40% to +30%
    const yScale = d3.scaleLinear()
      .domain([-40, 30])
      .range([height, 0])

    // Helper to query density at a given pctOffset for a specific expiry
    const getDensityAtOffset = (exp: any, pct: number) => {
      const pdf = exp.pdf;
      if (pdf.length === 0) return 0;
      
      let closest = pdf[0];
      let minDiff = Math.abs(pdf[0].pctOffset - pct);
      for (let i = 1; i < pdf.length; i++) {
        const diff = Math.abs(pdf[i].pctOffset - pct);
        if (diff < minDiff) {
          minDiff = diff;
          closest = pdf[i];
        }
      }
      return closest.density;
    }

    // Generate flat grid cell array with bilinear DTE interpolation
    const cells: any[] = []
    for (let col = 0; col < numCols; col++) {
      const dte = (col / (numCols - 1)) * maxDte;
      
      const colCells: any[] = []
      for (let row = 0; row < numRows; row++) {
        const pctOffset = -40 + (row / (numRows - 1)) * 70;
        
        let density = 0;
        if (dte <= sortedExpiries[0].daysToExpiry) {
          density = getDensityAtOffset(sortedExpiries[0], pctOffset);
        } else if (dte >= sortedExpiries[sortedExpiries.length - 1].daysToExpiry) {
          density = getDensityAtOffset(sortedExpiries[sortedExpiries.length - 1], pctOffset);
        } else {
          const i = sortedExpiries.findIndex((exp, idx) => {
            return exp.daysToExpiry <= dte && sortedExpiries[idx + 1].daysToExpiry >= dte;
          });
          if (i !== -1) {
            const expA = sortedExpiries[i];
            const expB = sortedExpiries[i + 1];
            const t = (dte - expA.daysToExpiry) / (expB.daysToExpiry - expA.daysToExpiry || 1);
            const densA = getDensityAtOffset(expA, pctOffset);
            const densB = getDensityAtOffset(expB, pctOffset);
            density = densA + t * (densB - densA);
          }
        }
        colCells.push({ dte, pctOffset, density });
      }
      
      const peakDensity = d3.max(colCells, c => c.density) || 1;
      colCells.forEach(cell => {
        const strike = spotPrice * (1 + cell.pctOffset / 100);
        cells.push({
          dte: cell.dte,
          pctOffset: cell.pctOffset,
          strike,
          density: cell.density,
          normalizedDensity: peakDensity > 0 ? cell.density / peakDensity : 0
        });
      });
    }

    // Sequential color scale matching "Inferno" (purple -> orange -> yellow/white)
    const colorScale = d3.scaleSequential(d3.interpolateInferno)
      .domain([0, 1])

    // Draw Heatmap cells with 0.2px gap
    g.selectAll('.cell')
      .data(cells)
      .join('rect')
      .attr('class', 'cell')
      .attr('x', d => xScale(d.dte))
      .attr('y', d => yScale(d.pctOffset) - cellSize)
      .attr('width', Math.max(0.5, cellSize - 0.2))
      .attr('height', Math.max(0.5, cellSize - 0.2))
      .attr('fill', d => colorScale(d.normalizedDensity))
      .on('mousemove', (event, d) => {
        if (!tooltipRef.current || !containerRef3D.current) return
        const containerRect = containerRef3D.current.getBoundingClientRect()
        
        tooltipRef.current.innerHTML = `
          <div class="flex items-center justify-between border-b border-[#222]/40 pb-1.5 mb-1 flex-row gap-6">
            <span class="text-[10px] font-mono font-bold text-[#E5E5E5] uppercase tracking-wider">Maturity Horizon</span>
            <span class="text-[10px] font-mono text-[#00C805] font-bold">${d.dte.toFixed(1)} DTE</span>
          </div>
          <div class="flex flex-col gap-1.5 mt-1">
            <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
              <span class="text-[#949494]">Strike Level</span>
              <span class="text-[#E5E5E5] font-bold">$${d.strike.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
            </div>
            <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
              <span class="text-[#949494]">Price Offset</span>
              <span class="font-bold ${d.pctOffset >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${d.pctOffset >= 0 ? '+' : ''}${d.pctOffset.toFixed(1)}%</span>
            </div>
            <div class="flex items-center justify-between text-[10px] font-mono border-t border-[#222]/20 pt-1.5 mt-0.5 flex-row gap-6">
              <span class="text-[#949494]">Relative Prob</span>
              <span class="text-[#00C8FF] font-bold">${(d.normalizedDensity * 100).toFixed(0)}%</span>
            </div>
          </div>
        `
        tooltipRef.current.style.opacity = '1'

        const relX = event.clientX - containerRect.left
        const relY = event.clientY - containerRect.top

        // Intelligent edge-detection positioning
        if (relX > containerRect.width - 280) {
          tooltipRef.current.style.left = `${relX - 15}px`
          tooltipRef.current.style.transform = 'translateX(-100%)'
        } else {
          tooltipRef.current.style.left = `${relX + 15}px`
          tooltipRef.current.style.transform = 'none'
        }

        if (relY < 120) {
          tooltipRef.current.style.top = `${relY + 20}px`
        } else if (relY > containerRect.height - 120) {
          tooltipRef.current.style.top = `${relY - 120}px`
        } else {
          tooltipRef.current.style.top = `${relY - 45}px`
        }
      })
      .on('mouseleave', () => {
        if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
      })

    // Dotted Spot Line in the center (0% offset)
    const spotY = yScale(0)
    if (spotY >= 0 && spotY <= height) {
      g.append('line')
        .attr('x1', xOffset).attr('x2', xOffset + gridWidth)
        .attr('y1', spotY).attr('y2', spotY)
        .attr('stroke', '#FFFFFF')
        .attr('stroke-width', 0.8)
        .attr('stroke-dasharray', '3, 3')
        .style('opacity', 0.4)

      g.append('text')
        .attr('x', xOffset + 6)
        .attr('y', spotY - 4)
        .attr('fill', '#FFFFFF')
        .style('font-family', typography.fontMono)
        .style('font-size', '8px')
        .style('opacity', 0.5)
        .text('SPOT REFERENCE')
    }

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(8).tickFormat(d => `${d} DTE`)
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    xAxisG.select('.domain').attr('stroke', '#1A1A1E')
    xAxisG.selectAll('.tick text')
      .attr('fill', colors.text.muted)
      .style('font-family', typography.fontMono)
      .style('font-size', '8.5px')
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

  }, [data, dims3D, spotPrice])

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

  // Map vertical wheel scroll to horizontal scrolling for density curves expiries selector
  useEffect(() => {
    const el = densityScrollRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      el.scrollLeft += e.deltaY * 0.8
    }

    el.addEventListener("wheel", handleWheel, { passive: false })
    return () => el.removeEventListener("wheel", handleWheel)
  }, [dropdownExpiries])

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
          </div>

          {dropdownExpiries.length > 0 && (
            <div className="flex items-center pb-1 flex-shrink-0">
              <div 
                ref={densityScrollRef}
                className="flex-1 flex gap-1.5 overflow-x-auto whitespace-nowrap py-1.5 px-2 bg-black/40 border border-[#1A1A1D] rounded scroll-smooth"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {dropdownExpiries.map(exp => {
                  const active = exp.value === selectedExpiry;
                  return (
                    <button
                      key={exp.value}
                      onClick={() => setSelectedExpiry(exp.value)}
                      className={`px-3 py-1 rounded text-[10px] font-mono font-medium border uppercase transition-all duration-150 flex-shrink-0 ${
                        active
                          ? 'bg-terminal-green/10 border-terminal-green text-terminal-green shadow-[0_0_8px_rgba(0,200,5,0.15)]'
                          : 'bg-[#0A0A0C] border-[#1A1A1E] text-[#949494] hover:text-[#E5E5E5] hover:border-[#333]'
                      }`}
                    >
                      {exp.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
              className="absolute pointer-events-none opacity-0 bg-[#070709]/95 border border-[#141416]/90 rounded p-3 flex flex-col gap-2 shadow-2xl z-30 min-w-[260px] transition-opacity duration-100 text-[#D4D4D8]"
              style={{ width: "max-content" }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
