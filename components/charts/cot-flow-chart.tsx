"use client"

import { useEffect, useRef, useState, useMemo } from 'react'
import * as d3 from 'd3'
import { getCotFlow, CotFlowData } from '@/lib/backend-api'
import { colors, typography } from '@/lib/design-tokens'

const MACRO_ASSETS = [
  { id: 'SPX', name: 'S&P 500 (E-Mini)' },
  { id: 'NDX', name: 'Nasdaq 100 (E-Mini)' },
  { id: 'GLD', name: 'Gold Futures' },
  { id: 'SLV', name: 'Silver Futures' },
  { id: 'USO', name: 'Crude Oil (WTI)' },
  { id: 'TNX', name: '10Y Treasury Note' },
  { id: 'DXY', name: 'US Dollar Index' },
  { id: 'IWM', name: 'Russell 2000' }
]

export function CotFlowChart() {
  const [selectedAsset, setSelectedAsset] = useState('SPX')
  const [data, setData] = useState<CotFlowData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'absolute' | 'net'>('absolute')
  const [hoveredData, setHoveredData] = useState<CotFlowData['data'][0] | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number, y: number } | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 600, height: 200 })

  // Fetch COT positioning
  useEffect(() => {
    let active = true
    async function loadData() {
      setIsLoading(true)
      setError(null)
      try {
        const res = await getCotFlow(selectedAsset)
        if (active) {
          if (res.success && res.data && res.data.length > 0) {
            setData(res)
          } else {
            setError('No COT data available. Please trigger manual collection or verify network.')
          }
        }
      } catch (err: any) {
        if (active) setError(err.message || 'Failed to fetch COT positioning')
      } finally {
        if (active) setIsLoading(false)
      }
    }
    loadData()
    return () => {
      active = false
    }
  }, [selectedAsset])

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
  }, [data])

  // Calculate current positions and weekly changes (handles hover state)
  const positioningStats = useMemo(() => {
    if (!data || !data.data || data.data.length < 1) return null

    const current = hoveredData || data.data[data.data.length - 1]
    const currentIndex = data.data.findIndex(d => d.reportDate === current.reportDate)
    const previous = currentIndex >= 1 ? data.data[currentIndex - 1] : null

    const commChange = previous ? current.commNet - previous.commNet : 0
    const noncommChange = previous ? current.noncommNet - previous.noncommNet : 0
    const retailChange = previous ? current.retailNet - previous.retailNet : 0

    return {
      current,
      changes: {
        comm: commChange,
        noncomm: noncommChange,
        retail: retailChange,
        hasChange: previous !== null
      }
    }
  }, [data, hoveredData])

  // Render D3 Historical Trend Line or Grouped Bar Chart
  useEffect(() => {
    if (!svgRef.current || !data || !data.data || data.data.length === 0) return

    const margin = { top: 20, right: 55, bottom: 30, left: 55 }
    const width = dims.width - margin.left - margin.right
    const height = dims.height - margin.top - margin.bottom
    if (width <= 0 || height <= 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', dims.width).attr('height', dims.height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Parse and prepare dates and net categories
    const series = data.data.map((d, index) => ({
      date: new Date(d.reportDate),
      openInterest: d.openInterest,
      comm: d.commNet,
      noncomm: d.noncommNet,
      retail: d.retailNet,
      reportDateString: d.reportDate,
      originalIndex: index
    }))

    // Scales
    const xScale = d3.scaleTime()
      .domain(d3.extent(series, d => d.date) as [Date, Date])
      .range([0, width])

    // Find the max absolute value across all net positions to center the zero line symmetrically
    const maxVal = d3.max(series, d => Math.max(Math.abs(d.comm), Math.abs(d.noncomm), Math.abs(d.retail))) || 100000
    const yMin = -maxVal
    const yMax = maxVal
    const pad = (yMax - yMin) * 0.05
    const yScale = d3.scaleLinear()
      .domain([yMin - pad, yMax + pad])
      .range([height, 0])

    // Scale for Open Interest (right Y axis)
    const maxOI = d3.max(series, d => d.openInterest) || 100000
    const yOI = d3.scaleLinear()
      .domain([0, maxOI * 1.1])
      .range([height, 0])

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

    // Zero reference line
    g.append('line')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', yScale(0)).attr('y2', yScale(0))
      .attr('stroke', '#333')
      .attr('stroke-width', 1.2)

    if (viewMode === 'net') {
      // Line Generators
      const commLine = d3.line<any>().x(d => xScale(d.date)).y(d => yScale(d.comm)).curve(d3.curveMonotoneX)
      const noncommLine = d3.line<any>().x(d => xScale(d.date)).y(d => yScale(d.noncomm)).curve(d3.curveMonotoneX)
      const retailLine = d3.line<any>().x(d => xScale(d.date)).y(d => yScale(d.retail)).curve(d3.curveMonotoneX)

      // Draw lines
      g.append('path').datum(series).attr('d', commLine).attr('fill', 'none').attr('stroke', '#EF4444').attr('stroke-width', 1.8)
      g.append('path').datum(series).attr('d', noncommLine).attr('fill', 'none').attr('stroke', '#3B82F6').attr('stroke-width', 1.8)
      g.append('path').datum(series).attr('d', retailLine).attr('fill', 'none').attr('stroke', '#FBBF24').attr('stroke-width', 1.2)
    } else {
      // Grouped Bar Chart Mode: Red, Blue, Yellow bars side-by-side
      const groupWidth = Math.max(9, (width / series.length) * 0.88)
      const singleBarWidth = groupWidth / 3

      series.forEach(d => {
        const centerX = xScale(d.date)

        // 1. Commercials (Red)
        const commX = centerX - 1.5 * singleBarWidth
        const commVal = d.comm
        const commH = Math.abs(yScale(commVal) - yScale(0))
        const commY = commVal >= 0 ? yScale(commVal) : yScale(0)

        g.append('rect')
          .attr('x', commX)
          .attr('y', commY)
          .attr('width', singleBarWidth - 0.2)
          .attr('height', Math.max(1, commH))
          .attr('fill', '#EF4444')
          .attr('rx', 0.5)

        // 2. Large Speculators (Blue)
        const noncommX = centerX - 0.5 * singleBarWidth
        const noncommVal = d.noncomm
        const noncommH = Math.abs(yScale(noncommVal) - yScale(0))
        const noncommY = noncommVal >= 0 ? yScale(noncommVal) : yScale(0)

        g.append('rect')
          .attr('x', noncommX)
          .attr('y', noncommY)
          .attr('width', singleBarWidth - 0.2)
          .attr('height', Math.max(1, noncommH))
          .attr('fill', '#3B82F6')
          .attr('rx', 0.5)

        // 3. Small Speculators (Yellow)
        const retailX = centerX + 0.5 * singleBarWidth
        const retailVal = d.retail
        const retailH = Math.abs(yScale(retailVal) - yScale(0))
        const retailY = retailVal >= 0 ? yScale(retailVal) : yScale(0)

        g.append('rect')
          .attr('x', retailX)
          .attr('y', retailY)
          .attr('width', singleBarWidth - 0.2)
          .attr('height', Math.max(1, retailH))
          .attr('fill', '#FBBF24')
          .attr('rx', 0.5)
      })
    }

    // Overlay Open Interest Line on secondary Y axis
    const oiLine = d3.line<any>()
      .x(d => xScale(d.date))
      .y(d => yOI(d.openInterest))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(series)
      .attr('d', oiLine)
      .attr('fill', 'none')
      .attr('stroke', '#E5E5E5') // light grey/white
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3,3')

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat('%b %y') as any)
    const xAxisG = g.append('g').attr('transform', `translate(0,${height})`).call(xAxis)
    xAxisG.select('.domain').attr('stroke', '#1C1C21')
    xAxisG.selectAll('.tick text').attr('fill', colors.text.muted).style('font-family', typography.fontMono).style('font-size', '9px')
    xAxisG.selectAll('.tick line').attr('stroke', '#1C1C21')

    const yFormatter = d3.format('~s')
    const yAxisLeft = d3.axisLeft(yScale).ticks(5).tickFormat(yFormatter as any)
    const yAxisLeftG = g.append('g').call(yAxisLeft)
    yAxisLeftG.select('.domain').attr('stroke', '#1C1C21')
    yAxisLeftG.selectAll('.tick text').attr('fill', colors.text.muted).style('font-family', typography.fontMono).style('font-size', '9px')
    yAxisLeftG.selectAll('.tick line').attr('stroke', '#1C1C21')

    // Right axis for Open Interest
    const yAxisRight = d3.axisRight(yOI).ticks(5).tickFormat(yFormatter as any)
    const yAxisRightG = g.append('g').attr('transform', `translate(${width},0)`).call(yAxisRight)
    yAxisRightG.select('.domain').attr('stroke', '#1C1C21')
    yAxisRightG.selectAll('.tick text').attr('fill', '#777').style('font-family', typography.fontMono).style('font-size', '9px')
    yAxisRightG.selectAll('.tick line').attr('stroke', '#1C1C21')

    // Hover interactive elements
    const bisectDate = d3.bisector((d: any) => d.date).left
    const hoverLine = g.append('line')
      .attr('class', 'hover-line')
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#444')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .style('opacity', 0)

    g.append('rect')
      .attr('class', 'overlay')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'transparent')
      .style('pointer-events', 'all')
      .on('mousemove', function (event) {
        const [mouseX] = d3.pointer(event)
        const date = xScale.invert(mouseX)
        const index = bisectDate(series, date, 1)
        const d0 = series[index - 1]
        const d1 = series[index]
        let d = d0
        if (d1 && date.getTime() - d0.date.getTime() > d1.date.getTime() - date.getTime()) {
          d = d1
        }
        if (d) {
          hoverLine
            .attr('x1', xScale(d.date))
            .attr('x2', xScale(d.date))
            .style('opacity', 1)

          const orig = data.data.find(x => x.reportDate === d.reportDateString)
          if (orig) {
            setHoveredData(orig)
            setTooltipPos({ x: event.offsetX, y: event.offsetY })
          }
        }
      })
      .on('mouseleave', () => {
        hoverLine.style('opacity', 0)
        setHoveredData(null)
        setTooltipPos(null)
      })

  }, [data, dims, viewMode])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#020203] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 border-b border-[#141416] pb-3 flex-shrink-0">
        <div>
          <h2 className="text-xs font-mono font-bold text-[#E5E5E5] tracking-wider uppercase">Commitments of Traders (COT) Flow</h2>
          <p className="text-[10px] font-mono text-[#555] mt-0.5">CFTC institutional net positioning and net change (contracts)</p>
        </div>

        <div className="flex items-center gap-4">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-[#0A0A0C] border border-[#141416] rounded p-0.5">
            <button
              onClick={() => setViewMode('absolute')}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${viewMode === 'absolute'
                ? 'bg-[#1C1C21] text-white font-bold'
                : 'text-[#555] hover:text-[#888]'
                }`}
            >
              Absolute
            </button>
            <button
              onClick={() => setViewMode('net')}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${viewMode === 'net'
                ? 'bg-[#1C1C21] text-white font-bold'
                : 'text-[#555] hover:text-[#888]'
                }`}
            >
              Net Flow
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-[#555] uppercase">Asset</span>
            <select
              value={selectedAsset}
              onChange={(e) => setSelectedAsset(e.target.value)}
              className="bg-black border border-[#1A1A1E] text-xs font-mono text-[#E5E5E5] rounded px-2.5 py-1 focus:outline-none focus:border-[#444]"
            >
              {MACRO_ASSETS.map(asset => (
                <option key={asset.id} value={asset.id}>{asset.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {isLoading && !data && !error && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-terminal-green">
            <div className="w-3.5 h-3.5 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
            <span className="text-[10px] font-mono tracking-widest uppercase">INGESTING CFTC DATA STREAM...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex-1 flex items-center justify-center text-xs font-mono text-[#FF3B60]">
          ⚠️ ERROR: {error}
        </div>
      )}

      {data && !positioningStats && (
        <div className="flex-1 flex items-center justify-center text-xs font-mono text-[#555]">
          No COT data available. Please trigger manual collection or verify network.
        </div>
      )}

      {data && positioningStats && (
        <div className="flex-1 flex flex-col min-h-0 gap-4">

          {/* Net positioning board */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-shrink-0">
            {/* Commercials */}
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                  <span className="text-[8px] font-mono text-[#555] uppercase tracking-wider">Commercials (Hedgers)</span>
                </div>
                <span className="text-xs font-mono font-bold text-[#E5E5E5] block mt-1">
                  {positioningStats.current.commNet >= 0 ? '+' : ''}{positioningStats.current.commNet.toLocaleString()} net
                </span>
              </div>
              <div className="border-t border-[#141416] mt-2 pt-1 flex items-center justify-between text-[9px] font-mono">
                <span className="text-[#555]">WEEKLY CHANGE:</span>
                <span className={!positioningStats.changes.hasChange ? 'text-[#555]' : (positioningStats.changes.comm >= 0 ? 'text-[#EF4444]' : 'text-[#FF3B60]')}>
                  {!positioningStats.changes.hasChange ? '—' : `${positioningStats.changes.comm >= 0 ? '+' : ''}${positioningStats.changes.comm.toLocaleString()}`}
                </span>
              </div>
            </div>

            {/* Speculators */}
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                  <span className="text-[8px] font-mono text-[#555] uppercase tracking-wider">Large Speculators (Funds)</span>
                </div>
                <span className="text-xs font-mono font-bold text-[#E5E5E5] block mt-1">
                  {positioningStats.current.noncommNet >= 0 ? '+' : ''}{positioningStats.current.noncommNet.toLocaleString()} net
                </span>
              </div>
              <div className="border-t border-[#141416] mt-2 pt-1 flex items-center justify-between text-[9px] font-mono">
                <span className="text-[#555]">WEEKLY CHANGE:</span>
                <span className={!positioningStats.changes.hasChange ? 'text-[#555]' : (positioningStats.changes.noncomm >= 0 ? 'text-[#3B82F6]' : 'text-[#FF3B60]')}>
                  {!positioningStats.changes.hasChange ? '—' : `${positioningStats.changes.noncomm >= 0 ? '+' : ''}${positioningStats.changes.noncomm.toLocaleString()}`}
                </span>
              </div>
            </div>

            {/* Retail */}
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#FBBF24]" />
                  <span className="text-[8px] font-mono text-[#555] uppercase tracking-wider">Retail (Small Speculators)</span>
                </div>
                <span className="text-xs font-mono font-bold text-[#E5E5E5] block mt-1">
                  {positioningStats.current.retailNet >= 0 ? '+' : ''}{positioningStats.current.retailNet.toLocaleString()} net
                </span>
              </div>
              <div className="border-t border-[#141416] mt-2 pt-1 flex items-center justify-between text-[9px] font-mono">
                <span className="text-[#555]">WEEKLY CHANGE:</span>
                <span className={!positioningStats.changes.hasChange ? 'text-[#555]' : (positioningStats.changes.retail >= 0 ? 'text-[#FBBF24]' : 'text-[#FF3B60]')}>
                  {!positioningStats.changes.hasChange ? '—' : `${positioningStats.changes.retail >= 0 ? '+' : ''}${positioningStats.changes.retail.toLocaleString()}`}
                </span>
              </div>
            </div>
          </div>

          {/* D3 Line/Bar Chart Container */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <span className="text-[14px] font-mono text-[#e8e8e8] uppercase tracking-wider block">Commitments of Traders Historical Trend</span>

              {/* Chart Legend */}
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-[#EF4444] rounded-sm" />
                  <span className="text-[#666]">Commercials</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-[#3B82F6] rounded-sm" />
                  <span className="text-[#666]">Large Spec</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-[#FBBF24] rounded-sm" />
                  <span className="text-[#666]">Small Spec</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-px border-t border-dashed border-[#E5E5E5]" />
                  <span className="text-[#666]">Open Interest</span>
                </div>
              </div>
            </div>

            <div ref={containerRef} className="flex-1 min-h-[260px] relative">
              {data.data.length >= 2 ? (
                <svg ref={svgRef} className="w-full h-full" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center border border-dashed border-[#1A1A1E] rounded text-[9px] font-mono text-[#555] uppercase tracking-widest bg-black/10">
                  Historical trend requires multiple weeks of data
                </div>
              )}

              {/* Tooltip Overlay */}
              {hoveredData && tooltipPos && positioningStats && (
                <div 
                  className="absolute pointer-events-none bg-[#070709]/95 border border-[#141416]/90 rounded p-3 flex flex-col gap-2 shadow-2xl z-30 min-w-[280px]"
                  style={{
                    left: `${tooltipPos.x + 15}px`,
                    top: `${tooltipPos.y + 15}px`,
                    transform: tooltipPos.x > dims.width - 320 ? 'translateX(-110%)' : 'none'
                  }}
                >
                  <div className="flex items-center justify-between border-b border-[#222]/40 pb-1.5 mb-0.5">
                    <span className="text-[10px] font-mono font-bold text-[#E5E5E5] uppercase tracking-wider">COT Weekly Change</span>
                    <span className="text-[9px] font-mono text-[#777]">{positioningStats.current.reportDate}</span>
                  </div>

                  {/* Commercials Change Bar */}
                  <div className="flex items-center justify-between text-[9px] font-mono">
                    <span className="w-20 text-[#EF4444] font-bold">Commercials</span>
                    <div className="flex-1 mx-2.5 h-2 bg-[#111115] border border-[#1A1A22] rounded-sm relative overflow-hidden">
                      {positioningStats.changes.comm !== 0 && (
                        <div
                          className={`h-full absolute ${positioningStats.changes.comm >= 0 ? 'bg-[#EF4444]/40 border-r border-[#EF4444]' : 'bg-[#FF3B60]/40 border-l border-[#FF3B60]'}`}
                          style={{
                            left: positioningStats.changes.comm >= 0 ? '50%' : 'auto',
                            right: positioningStats.changes.comm < 0 ? '50%' : 'auto',
                            width: `${Math.min(50, (Math.abs(positioningStats.changes.comm) / 25000) * 50)}%`
                          }}
                        />
                      )}
                      <div className="w-px h-full bg-[#2A2A2A] absolute left-1/2" />
                    </div>
                    <span className={`w-14 text-right ${positioningStats.changes.comm >= 0 ? 'text-[#EF4444]' : 'text-[#FF3B60]'}`}>
                      {positioningStats.changes.comm >= 0 ? '+' : ''}{(positioningStats.changes.comm / 1000).toFixed(1)}k
                    </span>
                  </div>

                  {/* Speculators Change Bar */}
                  <div className="flex items-center justify-between text-[9px] font-mono">
                    <span className="w-20 text-[#3B82F6] font-bold">Large Spec</span>
                    <div className="flex-1 mx-2.5 h-2 bg-[#111115] border border-[#1A1A22] rounded-sm relative overflow-hidden">
                      {positioningStats.changes.noncomm !== 0 && (
                        <div
                          className={`h-full absolute ${positioningStats.changes.noncomm >= 0 ? 'bg-[#3B82F6]/40 border-r border-[#3B82F6]' : 'bg-[#FF3B60]/40 border-l border-[#FF3B60]'}`}
                          style={{
                            left: positioningStats.changes.noncomm >= 0 ? '50%' : 'auto',
                            right: positioningStats.changes.noncomm < 0 ? '50%' : 'auto',
                            width: `${Math.min(50, (Math.abs(positioningStats.changes.noncomm) / 25000) * 50)}%`
                          }}
                        />
                      )}
                      <div className="w-px h-full bg-[#2A2A2A] absolute left-1/2" />
                    </div>
                    <span className={`w-14 text-right ${positioningStats.changes.noncomm >= 0 ? 'text-[#3B82F6]' : 'text-[#FF3B60]'}`}>
                      {positioningStats.changes.noncomm >= 0 ? '+' : ''}{(positioningStats.changes.noncomm / 1000).toFixed(1)}k
                    </span>
                  </div>

                  {/* Retail Change Bar */}
                  <div className="flex items-center justify-between text-[9px] font-mono">
                    <span className="w-20 text-[#FBBF24] font-bold">Retail</span>
                    <div className="flex-1 mx-2.5 h-2 bg-[#111115] border border-[#1A1A22] rounded-sm relative overflow-hidden">
                      {positioningStats.changes.retail !== 0 && (
                        <div
                          className={`h-full absolute ${positioningStats.changes.retail >= 0 ? 'bg-[#FBBF24]/40 border-r border-[#FBBF24]' : 'bg-[#FF3B60]/40 border-l border-[#FF3B60]'}`}
                          style={{
                            left: positioningStats.changes.retail >= 0 ? '50%' : 'auto',
                            right: positioningStats.changes.retail < 0 ? '50%' : 'auto',
                            width: `${Math.min(50, (Math.abs(positioningStats.changes.retail) / 25000) * 50)}%`
                          }}
                        />
                      )}
                      <div className="w-px h-full bg-[#2A2A2A] absolute left-1/2" />
                    </div>
                    <span className={`w-14 text-right ${positioningStats.changes.retail >= 0 ? 'text-[#FBBF24]' : 'text-[#FF3B60]'}`}>
                      {positioningStats.changes.retail >= 0 ? '+' : ''}{(positioningStats.changes.retail / 1000).toFixed(1)}k
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-[#141416] pt-2 flex items-center justify-between text-[8px] font-mono text-[#444] flex-shrink-0">
            <span>SOURCE: CFTC WEEKLY COMMITMENTS OF TRADERS COMBINED REPORT</span>
            <span>{hoveredData ? 'REPORT DATE:' : 'LAST REPORT DATE:'} {positioningStats.current.reportDate}</span>
          </div>
        </div>
      )}
    </div>
  )
}
