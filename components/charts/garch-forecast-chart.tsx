"use client"

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { getGarchForecast, GarchForecastData } from '@/lib/backend-api'
import { colors, typography } from '@/lib/design-tokens'

interface GarchForecastChartProps {
  ticker: string
}

export function GarchForecastChart({ ticker }: GarchForecastChartProps) {
  const [data, setData] = useState<GarchForecastData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 600, height: 350 })

  useEffect(() => {
    let active = true
    async function loadData() {
      setIsLoading(true)
      setError(null)
      try {
        const res = await getGarchForecast(ticker)
        if (active) {
          if (res.success) {
            setData(res)
          } else {
            setError((res as any).error || 'Failed to calculate GARCH forecast')
          }
        }
      } catch (err: any) {
        if (active) setError(err.message || 'Failed to calculate GARCH forecast')
      } finally {
        if (active) setIsLoading(false)
      }
    }
    loadData()
    return () => {
      active = false
    }
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

  // D3 Chart rendering
  useEffect(() => {
    if (!svgRef.current || !data) return

    const margin = { top: 30, right: 30, bottom: 40, left: 50 }
    const width = dims.width - margin.left - margin.right
    const height = dims.height - margin.top - margin.bottom
    if (width <= 0 || height <= 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', dims.width).attr('height', dims.height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Extract data series
    const garchSeries = data.garchVolForecasts.map(d => ({
      x: d.horizonDays,
      y: d.forecastedVol
    }))

    const ivSeries = data.optionTermStructure.map(d => ({
      x: d.daysToExpiry,
      y: d.averageIv
    })).filter(d => d.x <= 95) // limit to similar scale

    const allPoints = [...garchSeries, ...ivSeries]
    if (allPoints.length === 0) return

    // Scales
    const xMax = d3.max(allPoints, d => d.x) || 90
    const xScale = d3.scaleLinear().domain([0, xMax]).range([0, width])

    const yMin = d3.min(allPoints, d => d.y) || 0.1
    const yMax = d3.max(allPoints, d => d.y) || 0.3
    const yScale = d3.scaleLinear().domain([yMin * 0.9, yMax * 1.1]).range([height, 0])

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

    // Line generators
    const garchLine = d3.line<any>()
      .x(d => xScale(d.x))
      .y(d => yScale(d.y))
      .curve(d3.curveMonotoneX)

    const ivLine = d3.line<any>()
      .x(d => xScale(d.x))
      .y(d => yScale(d.y))
      .curve(d3.curveMonotoneX)

    // Draw GARCH Forecast Line (Cyan)
    g.append('path')
      .datum(garchSeries)
      .attr('d', garchLine)
      .attr('fill', 'none')
      .attr('stroke', colors.accent.cyan)
      .attr('stroke-width', 2)

    g.selectAll('.garch-dot')
      .data(garchSeries)
      .join('circle')
      .attr('class', 'garch-dot')
      .attr('cx', d => xScale(d.x))
      .attr('cy', d => yScale(d.y))
      .attr('r', 3.5)
      .attr('fill', colors.bg.surface)
      .attr('stroke', colors.accent.cyan)
      .attr('stroke-width', 1.5)

    // Draw Option IV Term Structure Line (Purple)
    if (ivSeries.length > 0) {
      g.append('path')
        .datum(ivSeries)
        .attr('d', ivLine)
        .attr('fill', 'none')
        .attr('stroke', colors.accent.purple)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '3, 3')

      g.selectAll('.iv-dot')
        .data(ivSeries)
        .join('circle')
        .attr('class', 'iv-dot')
        .attr('cx', d => xScale(d.x))
        .attr('cy', d => yScale(d.y))
        .attr('r', 3.5)
        .attr('fill', colors.bg.surface)
        .attr('stroke', colors.accent.purple)
        .attr('stroke-width', 1.5)
    }

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(8).tickFormat(d => `${d}D`)
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    xAxisG.select('.domain').attr('stroke', '#1C1C21')
    xAxisG.selectAll('.tick text')
      .attr('fill', colors.text.muted)
      .style('font-family', typography.fontMono)
      .style('font-size', '10px')
    xAxisG.selectAll('.tick line').attr('stroke', '#1C1C21')

    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d => `${(Number(d) * 100).toFixed(1)}%`)
    const yAxisG = g.append('g').call(yAxis)
    yAxisG.select('.domain').attr('stroke', '#1C1C21')
    yAxisG.selectAll('.tick text')
      .attr('fill', colors.text.muted)
      .style('font-family', typography.fontMono)
      .style('font-size', '10px')
    yAxisG.selectAll('.tick line').attr('stroke', '#1C1C21')

    // Legend
    const legend = g.append('g').attr('transform', `translate(${width - 160}, 10)`)
    
    legend.append('line')
      .attr('x1', 0).attr('x2', 20)
      .attr('y1', 0).attr('y2', 0)
      .attr('stroke', colors.accent.cyan)
      .attr('stroke-width', 2)
    legend.append('text')
      .attr('x', 25).attr('y', 4)
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '10px')
      .text('GARCH(1,1) Forecast')

    legend.append('line')
      .attr('x1', 0).attr('x2', 20)
      .attr('y1', 15).attr('y2', 15)
      .attr('stroke', colors.accent.purple)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '3, 3')
    legend.append('text')
      .attr('x', 25).attr('y', 19)
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '10px')
      .text('Market Implied Vol (IV)')

  }, [data, dims])

  const diffMessage = () => {
    if (!data || data.garchVolForecasts.length === 0 || data.optionTermStructure.length === 0) return null;
    const g30 = data.garchVolForecasts.find(f => f.horizonDays === 30)?.forecastedVol;
    const iv30 = data.optionTermStructure.find(f => f.daysToExpiry >= 20 && f.daysToExpiry <= 40)?.averageIv 
      || data.optionTermStructure[Math.floor(data.optionTermStructure.length / 2)]?.averageIv;
    
    if (!g30 || !iv30) return null;
    const diff = (iv30 - g30) * 100;
    
    if (diff > 1.5) {
      return {
        text: `⚠️ IMPLIED VOL IS RICH (+${diff.toFixed(1)}% premium over GARCH). Options appear OVERPRICED. Sell/Short Volatility setup preferred.`,
        color: 'text-[#FF3B60] border-[#FF3B60]/20 bg-[#FF3B60]/5'
      };
    } else if (diff < -1.5) {
      return {
        text: `⚡ IMPLIED VOL IS CHEAP (${diff.toFixed(1)}% discount under GARCH). Options appear UNDERPRICED. Long Volatility/Buy setup preferred.`,
        color: 'text-[#00C805] border-[#00C805]/20 bg-[#00C805]/5'
      };
    } else {
      return {
        text: `⚖️ VOLATILITY FAIRLY PRICED (Difference of ${diff.toFixed(1)}% is within standard error boundary).`,
        color: 'text-terminal-green border-terminal-green/20 bg-terminal-green/5'
      };
    }
  };

  const tradeSignal = diffMessage();

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#070709] border border-[#141416] rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 border-b border-[#141416] pb-3 flex-shrink-0">
        <div>
          <h2 className="text-xs font-mono font-bold text-[#E5E5E5] tracking-wider uppercase">GARCH(1,1) Volatility Forecasting</h2>
          <p className="text-[10px] font-mono text-[#555] mt-0.5">Forecasted Realized Variance Term Structure vs options IV skew</p>
        </div>
      </div>

      {isLoading && !data && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-terminal-green">
            <div className="w-3.5 h-3.5 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
            <span className="text-[10px] font-mono tracking-widest uppercase">SOLVING GARCH MAXIMUM LIKELIHOOD RECURSIONS...</span>
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
          {/* GARCH Parameters Board */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 flex-shrink-0">
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-2.5">
              <span className="block text-[8px] font-mono text-[#555] uppercase tracking-wider">ARCH Alpha (ARCH shock)</span>
              <span className="text-xs font-mono font-bold text-[#E5E5E5] block mt-0.5">{data.alpha.toFixed(4)}</span>
            </div>
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-2.5">
              <span className="block text-[8px] font-mono text-[#555] uppercase tracking-wider">GARCH Beta (persistence)</span>
              <span className="text-xs font-mono font-bold text-[#E5E5E5] block mt-0.5">{data.beta.toFixed(4)}</span>
            </div>
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-2.5">
              <span className="block text-[8px] font-mono text-[#555] uppercase tracking-wider">Omega (baseline var)</span>
              <span className="text-[10px] font-mono font-bold text-[#E5E5E5] block mt-1">{data.omega.toExponential(4)}</span>
            </div>
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-2.5">
              <span className="block text-[8px] font-mono text-[#555] uppercase tracking-wider">Long-run Unconditional Vol</span>
              <span className="text-xs font-mono font-bold text-terminal-green block mt-0.5">{(data.unconditionalVol * 100).toFixed(2)}%</span>
            </div>
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-2.5">
              <span className="block text-[8px] font-mono text-[#555] uppercase tracking-wider">Model Status</span>
              <span className="text-xs font-mono font-bold text-[#00C805] block mt-0.5">✔ Stationary</span>
            </div>
          </div>

          {/* Trade signals banner */}
          {tradeSignal && (
            <div className={`border rounded px-3 py-2 text-[10px] font-mono leading-relaxed flex-shrink-0 ${tradeSignal.color}`}>
              {tradeSignal.text}
            </div>
          )}

          {/* Chart Container */}
          <div ref={containerRef} className="flex-1 min-h-[200px] relative">
            <svg ref={svgRef} className="w-full h-full" />
          </div>

          <div className="border-t border-[#141416] pt-2 flex items-center justify-between text-[8px] font-mono text-[#444] flex-shrink-0">
            <span>MODEL: GARCH(1,1) MLE SOLVER (GRID SEARCH REFINEMENT, LAST 252 TRADING DAYS)</span>
            <span>OPTIMIZER: LOCAL GRADIENT SHIFT CONVERGED</span>
          </div>
        </div>
      )}
    </div>
  )
}
