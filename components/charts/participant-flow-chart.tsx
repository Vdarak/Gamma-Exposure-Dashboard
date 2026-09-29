"use client"

import React, { useEffect, useRef, useState, useMemo } from 'react'
import * as d3 from 'd3'
import {
  getParticipantHistory,
  getParticipantDailySummary,
  getLiveIPFDeconstruction,
  ParticipantHistoryItem,
  ParticipantDailySummary,
} from '@/lib/backend-api'
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Info,
  Layers,
  Activity,
  ShieldAlert,
  Percent,
  Compass,
} from 'lucide-react'

type MetricView = 'fii_net' | 'fii_ratio' | 'all_futures' | 'retail_vs_pro' | 'live_ipf'
type Timeframe = '1M' | '3M' | '6M' | 'YTD'

export function ParticipantFlowChart() {
  const [history, setHistory] = useState<ParticipantHistoryItem[]>([])
  const [dailySummary, setDailySummary] = useState<ParticipantDailySummary | null>(null)
  const [ipfData, setIpfData] = useState<any | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [metricView, setMetricView] = useState<MetricView>('fii_net')
  const [timeframe, setTimeframe] = useState<Timeframe>('YTD')
  const [selectedTicker, setSelectedTicker] = useState<'NIFTY' | 'BANKNIFTY' | 'SENSEX'>('NIFTY')
  const [hoveredItem, setHoveredItem] = useState<ParticipantHistoryItem | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 800, height: 380 })

  // Fetch data
  const fetchData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [histRes, summaryRes] = await Promise.all([
        getParticipantHistory('2026-01-01', 300),
        getParticipantDailySummary(),
      ])

      if (histRes.success && histRes.data) {
        setHistory(histRes.data)
      }
      if (summaryRes.success && summaryRes.data) {
        setDailySummary(summaryRes.data)
      }
    } catch (err: any) {
      console.error('Participant fetch error:', err)
      setError(err.message || 'Failed to fetch participant positioning data')
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch live IPF deconstruction if selected
  const fetchIPF = async (ticker: string) => {
    try {
      const res = await getLiveIPFDeconstruction(ticker)
      if (res.success && res.data) {
        setIpfData(res.data)
      }
    } catch (e) {
      console.error('IPF fetch error:', e)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (metricView === 'live_ipf') {
      fetchIPF(selectedTicker)
    }
  }, [metricView, selectedTicker])

  // Resize Observer
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0) {
          setDims({ width, height: Math.max(340, height) })
        }
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Filter history by timeframe
  const filteredHistory = useMemo(() => {
    if (!history.length) return []
    if (timeframe === 'YTD') return history

    const cutoffDays = timeframe === '1M' ? 30 : timeframe === '3M' ? 90 : 180
    const now = new Date()
    const cutoff = new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000)

    const filtered = history.filter((item) => new Date(item.date) >= cutoff)
    return filtered.length > 0 ? filtered : history
  }, [history, timeframe])

  // Render D3 Interactive Chart
  useEffect(() => {
    if (!svgRef.current || !filteredHistory.length || metricView === 'live_ipf') return

    const margin = { top: 24, right: 65, bottom: 35, left: 65 }
    const width = dims.width - margin.left - margin.right
    const height = dims.height - margin.top - margin.bottom
    if (width <= 0 || height <= 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', dims.width).attr('height', dims.height)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Prepare time scale
    const dates = filteredHistory.map((d) => new Date(d.date))
    const xScale = d3
      .scaleTime()
      .domain(d3.extent(dates) as [Date, Date])
      .range([0, width])

    let linesData: { id: string; name: string; color: string; values: { date: Date; value: number }[] }[] = []
    let isPercent = false

    if (metricView === 'fii_net') {
      linesData = [
        {
          id: 'fii_fut',
          name: 'FII Net Futures',
          color: '#38BDF8',
          values: filteredHistory.map((d) => ({ date: new Date(d.date), value: d.fii.net_fut })),
        },
        {
          id: 'fii_ce',
          name: 'FII Net Calls',
          color: '#10B981',
          values: filteredHistory.map((d) => ({ date: new Date(d.date), value: d.fii.net_ce })),
        },
        {
          id: 'fii_pe',
          name: 'FII Net Puts',
          color: '#EF4444',
          values: filteredHistory.map((d) => ({ date: new Date(d.date), value: d.fii.net_pe })),
        },
      ]
    } else if (metricView === 'fii_ratio') {
      isPercent = true
      linesData = [
        {
          id: 'fii_ratio',
          name: 'FII Futures Long Ratio (%)',
          color: '#38BDF8',
          values: filteredHistory.map((d) => ({
            date: new Date(d.date),
            value: (d.fii.long_short_ratio ?? 0.5) * 100,
          })),
        },
      ]
    } else if (metricView === 'all_futures') {
      linesData = [
        {
          id: 'fii_fut',
          name: 'FII (Institutional)',
          color: '#38BDF8',
          values: filteredHistory.map((d) => ({ date: new Date(d.date), value: d.fii.net_fut })),
        },
        {
          id: 'pro_fut',
          name: 'Pro Desks',
          color: '#A78BFA',
          values: filteredHistory.map((d) => ({ date: new Date(d.date), value: d.pro.net_fut })),
        },
        {
          id: 'client_fut',
          name: 'Client (Retail)',
          color: '#F59E0B',
          values: filteredHistory.map((d) => ({ date: new Date(d.date), value: d.client.net_fut })),
        },
        {
          id: 'dii_fut',
          name: 'DII (Domestic Funds)',
          color: '#34D399',
          values: filteredHistory.map((d) => ({ date: new Date(d.date), value: d.dii.net_fut })),
        },
      ]
    } else if (metricView === 'retail_vs_pro') {
      linesData = [
        {
          id: 'client_ce',
          name: 'Retail Net Calls',
          color: '#F59E0B',
          values: filteredHistory.map((d) => ({ date: new Date(d.date), value: d.client.net_ce })),
        },
        {
          id: 'client_pe',
          name: 'Retail Net Puts (Harvesting)',
          color: '#F97316',
          values: filteredHistory.map((d) => ({ date: new Date(d.date), value: d.client.net_pe })),
        },
        {
          id: 'pro_ce',
          name: 'Pro Net Calls',
          color: '#8B5CF6',
          values: filteredHistory.map((d) => ({ date: new Date(d.date), value: d.pro.net_ce })),
        },
        {
          id: 'pro_pe',
          name: 'Pro Net Puts',
          color: '#C084FC',
          values: filteredHistory.map((d) => ({ date: new Date(d.date), value: d.pro.net_pe })),
        },
      ]
    }

    // Compute Y Domain
    let yScale: d3.ScaleLinear<number, number>
    if (isPercent) {
      yScale = d3.scaleLinear().domain([0, 100]).range([height, 0])
    } else {
      const allVals = linesData.flatMap((l) => l.values.map((v) => v.value))
      const maxAbs = d3.max(allVals.map(Math.abs)) || 100000
      const pad = maxAbs * 0.1
      yScale = d3
        .scaleLinear()
        .domain([-maxAbs - pad, maxAbs + pad])
        .range([height, 0])
    }

    // Grid lines (horizontal)
    const yTicks = isPercent ? [20, 40, 50, 60, 80] : yScale.ticks(6)
    g.selectAll('.grid-line')
      .data(yTicks)
      .join('line')
      .attr('class', 'grid-line')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', '#1E293B')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', (d) => (isPercent && d === 50 ? '4,4' : 'none'))

    // Zero / Benchmark Reference Line
    const zeroY = isPercent ? yScale(50) : yScale(0)
    g.append('line')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', zeroY)
      .attr('y2', zeroY)
      .attr('stroke', isPercent ? '#64748B' : '#475569')
      .attr('stroke-width', 1.5)

    if (isPercent) {
      g.append('text')
        .attr('x', width - 8)
        .attr('y', zeroY - 6)
        .attr('fill', '#94A3B8')
        .attr('font-size', '10px')
        .attr('text-anchor', 'end')
        .text('50% Neutral Threshold')
    }

    // X Axis
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(Math.min(filteredHistory.length, 8))
      .tickFormat((d: any) => d3.timeFormat('%d %b')(d))

    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(xAxis)
      .call((axis) => axis.select('.domain').attr('stroke', '#334155'))
      .call((axis) => axis.selectAll('.tick line').attr('stroke', '#334155'))
      .call((axis) =>
        axis.selectAll('.tick text').attr('fill', '#94A3B8').attr('font-size', '11px').attr('font-family', 'sans-serif')
      )

    // Y Axis (Left)
    const yAxis = d3
      .axisLeft(yScale)
      .ticks(6)
      .tickFormat((d: any) => (isPercent ? `${d}%` : d3.format('~s')(d)))

    g.append('g')
      .call(yAxis)
      .call((axis) => axis.select('.domain').attr('stroke', '#334155'))
      .call((axis) => axis.selectAll('.tick line').attr('stroke', '#334155'))
      .call((axis) =>
        axis.selectAll('.tick text').attr('fill', '#94A3B8').attr('font-size', '11px').attr('font-family', 'sans-serif')
      )

    // Line Generator
    const lineGen = d3
      .line<{ date: Date; value: number }>()
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.value))
      .curve(d3.curveMonotoneX)

    // Draw Lines
    linesData.forEach((line) => {
      // Glow shadow line
      g.append('path')
        .datum(line.values)
        .attr('d', lineGen)
        .attr('fill', 'none')
        .attr('stroke', line.color)
        .attr('stroke-width', 3)
        .attr('stroke-opacity', 0.25)

      // Main line
      g.append('path')
        .datum(line.values)
        .attr('d', lineGen)
        .attr('fill', 'none')
        .attr('stroke', line.color)
        .attr('stroke-width', 2)

      // Highlight endpoint dot
      const lastPoint = line.values[line.values.length - 1]
      if (lastPoint) {
        g.append('circle')
          .attr('cx', xScale(lastPoint.date))
          .attr('cy', yScale(lastPoint.value))
          .attr('r', 4)
          .attr('fill', line.color)
          .attr('stroke', '#0F172A')
          .attr('stroke-width', 2)
      }
    })

    // Interactive Hover Overlay
    const bisectDate = d3.bisector((d: ParticipantHistoryItem) => new Date(d.date)).left
    const focusLine = g
      .append('line')
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#94A3B8')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .style('opacity', 0)

    const overlay = g
      .append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')

    overlay
      .on('mousemove', function (event) {
        const [mx, my] = d3.pointer(event)
        const xDate = xScale.invert(mx)
        const idx = bisectDate(filteredHistory, xDate)
        const item = filteredHistory[Math.min(idx, filteredHistory.length - 1)]

        if (item) {
          const itemX = xScale(new Date(item.date))
          focusLine.attr('x1', itemX).attr('x2', itemX).style('opacity', 1)
          setHoveredItem(item)
          setTooltipPos({ x: event.clientX, y: event.clientY })
        }
      })
      .on('mouseleave', function () {
        focusLine.style('opacity', 0)
        setHoveredItem(null)
        setTooltipPos(null)
      })
  }, [filteredHistory, metricView, dims])

  return (
    <div className="flex flex-col gap-5 w-full text-slate-100">
      {/* ─── Top Control Header ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F172A]/80 backdrop-blur-md p-4 rounded-xl border border-slate-800 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-500/10 rounded-lg text-sky-400 border border-sky-500/20">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-wide text-white flex items-center gap-2">
              NSE Participant Flow & Positioning
              <span className="text-xs px-2 py-0.5 bg-sky-950 text-sky-300 rounded border border-sky-800">
                EOD Archive
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Time-series tracking of FII, Pro, Client (Retail), and DII derivatives positioning
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Metric View Tabs */}
          <div className="flex p-1 bg-slate-900 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setMetricView('fii_net')}
              className={`px-3 py-1.5 rounded-md transition-all ${
                metricView === 'fii_net'
                  ? 'bg-sky-500 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              FII Net
            </button>
            <button
              onClick={() => setMetricView('fii_ratio')}
              className={`px-3 py-1.5 rounded-md transition-all ${
                metricView === 'fii_ratio'
                  ? 'bg-sky-500 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              FII L/S %
            </button>
            <button
              onClick={() => setMetricView('all_futures')}
              className={`px-3 py-1.5 rounded-md transition-all ${
                metricView === 'all_futures'
                  ? 'bg-sky-500 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All Futures
            </button>
            <button
              onClick={() => setMetricView('retail_vs_pro')}
              className={`px-3 py-1.5 rounded-md transition-all ${
                metricView === 'retail_vs_pro'
                  ? 'bg-sky-500 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Pro vs Retail
            </button>
            <button
              onClick={() => setMetricView('live_ipf')}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
                metricView === 'live_ipf'
                  ? 'bg-indigo-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Live IPF Strikes
            </button>
          </div>

          {/* Timeframe Buttons */}
          {metricView !== 'live_ipf' && (
            <div className="flex p-1 bg-slate-900 rounded-lg border border-slate-800 text-xs">
              {(['1M', '3M', '6M', 'YTD'] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    timeframe === tf ? 'bg-slate-700 text-white font-medium' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          )}

          {/* Refresh Button */}
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-800 transition-colors"
            title="Refresh participant data"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* ─── Daily EOD Change Update Card ──────────────────────────────── */}
      {dailySummary && (
        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-5 shadow-xl relative overflow-hidden">
          {/* Subtle background glow based on sentiment */}
          <div
            className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl opacity-10 pointer-events-none"
            style={{ backgroundColor: dailySummary.sentiment_color }}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4 mb-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Daily EOD Update Card
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-mono">
                {dailySummary.date} {dailySummary.previous_date && `vs ${dailySummary.previous_date}`}
              </span>
            </div>

            {/* FII Sentiment Badge & Gauge */}
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-[11px] text-slate-400 uppercase tracking-wider">FII Futures Long %</div>
                <div className="text-base font-bold font-mono text-white">
                  {dailySummary.fii_long_short_pct.toFixed(1)}%
                </div>
              </div>
              <div
                className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 border"
                style={{
                  color: dailySummary.sentiment_color,
                  borderColor: `${dailySummary.sentiment_color}40`,
                  backgroundColor: `${dailySummary.sentiment_color}15`,
                }}
              >
                <Activity className="w-3.5 h-3.5" />
                {dailySummary.sentiment_label}
              </div>
            </div>
          </div>

          {/* 4-Participant Delta Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {/* 1. FII */}
            <div className="bg-slate-900/80 p-3.5 rounded-lg border border-slate-800 hover:border-sky-500/40 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-sky-400">FII (Foreign Inst)</span>
                <span className="text-[10px] text-slate-400">Net Pos & Δ</span>
              </div>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Futures:</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.fii.net_fut.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.fii.delta_fut >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      ({dailySummary.today.fii.delta_fut >= 0 ? '+' : ''}
                      {dailySummary.today.fii.delta_fut.toLocaleString()})
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Calls (CE):</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.fii.net_ce.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.fii.delta_ce >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      ({dailySummary.today.fii.delta_ce >= 0 ? '+' : ''}
                      {dailySummary.today.fii.delta_ce.toLocaleString()})
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Puts (PE):</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.fii.net_pe.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.fii.delta_pe >= 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      ({dailySummary.today.fii.delta_pe >= 0 ? '+' : ''}
                      {dailySummary.today.fii.delta_pe.toLocaleString()})
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Pro */}
            <div className="bg-slate-900/80 p-3.5 rounded-lg border border-slate-800 hover:border-violet-500/40 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-violet-400">Pro Desks (MMs)</span>
                <span className="text-[10px] text-slate-400">Net Pos & Δ</span>
              </div>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Futures:</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.pro.net_fut.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.pro.delta_fut >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      ({dailySummary.today.pro.delta_fut >= 0 ? '+' : ''}
                      {dailySummary.today.pro.delta_fut.toLocaleString()})
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Calls (CE):</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.pro.net_ce.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.pro.delta_ce >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      ({dailySummary.today.pro.delta_ce >= 0 ? '+' : ''}
                      {dailySummary.today.pro.delta_ce.toLocaleString()})
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Puts (PE):</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.pro.net_pe.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.pro.delta_pe >= 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      ({dailySummary.today.pro.delta_pe >= 0 ? '+' : ''}
                      {dailySummary.today.pro.delta_pe.toLocaleString()})
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Client */}
            <div className="bg-slate-900/80 p-3.5 rounded-lg border border-slate-800 hover:border-amber-500/40 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-amber-400">Client (Retail/HNI)</span>
                <span className="text-[10px] text-slate-400">Net Pos & Δ</span>
              </div>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Futures:</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.client.net_fut.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.client.delta_fut >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      ({dailySummary.today.client.delta_fut >= 0 ? '+' : ''}
                      {dailySummary.today.client.delta_fut.toLocaleString()})
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Calls (CE):</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.client.net_ce.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.client.delta_ce >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      ({dailySummary.today.client.delta_ce >= 0 ? '+' : ''}
                      {dailySummary.today.client.delta_ce.toLocaleString()})
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Puts (PE):</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.client.net_pe.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.client.delta_pe >= 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      ({dailySummary.today.client.delta_pe >= 0 ? '+' : ''}
                      {dailySummary.today.client.delta_pe.toLocaleString()})
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. DII */}
            <div className="bg-slate-900/80 p-3.5 rounded-lg border border-slate-800 hover:border-emerald-500/40 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-emerald-400">DII (Mutual Funds)</span>
                <span className="text-[10px] text-slate-400">Net Pos & Δ</span>
              </div>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Futures:</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.dii.net_fut.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.dii.delta_fut >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      ({dailySummary.today.dii.delta_fut >= 0 ? '+' : ''}
                      {dailySummary.today.dii.delta_fut.toLocaleString()})
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Calls (CE):</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.dii.net_ce.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.dii.delta_ce >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      ({dailySummary.today.dii.delta_ce >= 0 ? '+' : ''}
                      {dailySummary.today.dii.delta_ce.toLocaleString()})
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Puts (PE):</span>
                  <div className="text-right">
                    <span className="text-slate-200">{dailySummary.today.dii.net_pe.toLocaleString()}</span>
                    <span
                      className={`ml-1.5 text-[11px] font-medium ${
                        dailySummary.today.dii.delta_pe >= 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      ({dailySummary.today.dii.delta_pe >= 0 ? '+' : ''}
                      {dailySummary.today.dii.delta_pe.toLocaleString()})
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quant Commentary Banner */}
          <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 text-xs flex items-center gap-2.5">
            <Info className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="text-slate-300">
              <strong className="text-white">Institutional Verdict: </strong>
              {dailySummary.commentary}
            </span>
          </div>
        </div>
      )}

      {/* ─── Main Interactive Chart Section ────────────────────────────── */}
      {metricView !== 'live_ipf' ? (
        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-5 shadow-xl relative">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">
                {metricView === 'fii_net' && 'FII Historical Net Positions (Futures, Calls, Puts)'}
                {metricView === 'fii_ratio' && 'FII Index Futures Long % (Sentiment Oscillator)'}
                {metricView === 'all_futures' && 'All 4 Participants: Net Index Futures Distribution'}
                {metricView === 'retail_vs_pro' && 'Prop Desks vs Retail Options Skew'}
              </h3>
              <p className="text-xs text-slate-400">
                {filteredHistory.length} trading days recorded since{' '}
                {filteredHistory[0]?.date || '2026-01-01'}
              </p>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
              {metricView === 'fii_net' && (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-400" /> FII Net Futures
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> FII Net Calls
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-400" /> FII Net Puts
                  </span>
                </>
              )}
              {metricView === 'fii_ratio' && (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-400" /> FII Long %
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 border-t border-dashed border-slate-400" /> 50% Threshold
                  </span>
                </>
              )}
              {metricView === 'all_futures' && (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-400" /> FII
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-violet-400" /> Pro
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Retail
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> DII
                  </span>
                </>
              )}
              {metricView === 'retail_vs_pro' && (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Retail Calls
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-orange-400" /> Retail Puts
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-violet-400" /> Pro Calls
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-400" /> Pro Puts
                  </span>
                </>
              )}
            </div>
          </div>

          {/* SVG Canvas */}
          <div ref={containerRef} className="w-full h-[380px] relative">
            <svg ref={svgRef} className="w-full h-full overflow-visible" />
          </div>

          {/* Hover Crosshair Tooltip */}
          {hoveredItem && tooltipPos && (
            <div
              className="fixed z-50 pointer-events-none bg-slate-900/95 backdrop-blur-md border border-slate-700 p-3 rounded-lg shadow-2xl text-xs font-mono space-y-1.5 min-w-[200px]"
              style={{
                left: `${tooltipPos.x + 16}px`,
                top: `${tooltipPos.y - 40}px`,
              }}
            >
              <div className="text-slate-300 font-semibold border-b border-slate-800 pb-1 flex justify-between">
                <span>Date:</span>
                <span className="text-white">{hoveredItem.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sky-400">FII Net Fut:</span>
                <span className="text-white">{hoveredItem.fii.net_fut.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sky-400">FII L/S %:</span>
                <span className="text-white">
                  {((hoveredItem.fii.long_short_ratio ?? 0.5) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-400">FII Net CE:</span>
                <span className="text-white">{hoveredItem.fii.net_ce.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-rose-400">FII Net PE:</span>
                <span className="text-white">{hoveredItem.fii.net_pe.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-1">
                <span className="text-amber-400">Retail Net CE:</span>
                <span className="text-white">{hoveredItem.client.net_ce.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-amber-400">Retail Net PE:</span>
                <span className="text-white">{hoveredItem.client.net_pe.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ─── Phase 3: Live Strike-Level IPF Deconstructor View ────────────── */
        <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  Live Strike-Level IPF Position Deconstruction (Sinkhorn-Knopp)
                </h3>
                <p className="text-xs text-slate-400">
                  Deconstructed matrix X[k, p] across strikes & participants without crude global heuristics
                </p>
              </div>
            </div>

            {/* Ticker Selector */}
            <div className="flex items-center gap-2">
              {(['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTicker(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    selectedTicker === t
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {ipfData ? (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px]">Spot Price</div>
                  <div className="text-base font-bold text-white mt-0.5">
                    {ipfData.spot.toLocaleString()}
                  </div>
                </div>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px]">Deconstructed Strikes</div>
                  <div className="text-base font-bold text-sky-400 mt-0.5">
                    {ipfData.total_strikes}
                  </div>
                </div>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px]">Net Dealer GEX</div>
                  <div
                    className={`text-base font-bold mt-0.5 ${
                      ipfData.net_dealer_gex_crores >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {ipfData.net_dealer_gex_crores > 0 ? '+' : ''}
                    {ipfData.net_dealer_gex_crores.toLocaleString()} Cr
                  </div>
                </div>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px]">IPF Participant Anchor</div>
                  <div className="text-base font-bold text-slate-200 mt-0.5">
                    {ipfData.participant_date}
                  </div>
                </div>
              </div>

              {/* Granular Strike Table */}
              <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-800">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800 z-10">
                    <tr>
                      <th className="p-2.5">Strike</th>
                      <th className="p-2.5">Call OI</th>
                      <th className="p-2.5">Put OI</th>
                      <th className="p-2.5 text-sky-400">FII Net CE</th>
                      <th className="p-2.5 text-sky-400">FII Net PE</th>
                      <th className="p-2.5 text-amber-400">Retail Net CE</th>
                      <th className="p-2.5 text-amber-400">Retail Net PE</th>
                      <th className="p-2.5 text-violet-400">Pro Net CE</th>
                      <th className="p-2.5 text-violet-400">Pro Net PE</th>
                      <th className="p-2.5 text-right">Dealer GEX (Cr)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/60">
                    {ipfData.strikes?.slice(0, 30).map((s: any) => (
                      <tr key={s.strike} className="hover:bg-slate-800/40 transition-colors">
                        <td className="p-2.5 font-bold text-white">{s.strike}</td>
                        <td className="p-2.5 text-slate-300">{s.ce_oi.toLocaleString()}</td>
                        <td className="p-2.5 text-slate-300">{s.pe_oi.toLocaleString()}</td>
                        <td className={`p-2.5 ${s.fii.ce_net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {s.fii.ce_net.toLocaleString()}
                        </td>
                        <td className={`p-2.5 ${s.fii.pe_net >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {s.fii.pe_net.toLocaleString()}
                        </td>
                        <td className={`p-2.5 ${s.client.ce_net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {s.client.ce_net.toLocaleString()}
                        </td>
                        <td className={`p-2.5 ${s.client.pe_net >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {s.client.pe_net.toLocaleString()}
                        </td>
                        <td className={`p-2.5 ${s.pro.ce_net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {s.pro.ce_net.toLocaleString()}
                        </td>
                        <td className={`p-2.5 ${s.pro.pe_net >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {s.pro.pe_net.toLocaleString()}
                        </td>
                        <td
                          className={`p-2.5 text-right font-bold ${
                            s.gex_crores >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {s.gex_crores > 0 ? '+' : ''}
                          {s.gex_crores.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <RefreshCw className="w-5 h-5 animate-spin mr-2 text-indigo-400" />
              Loading live IPF strike deconstruction...
            </div>
          )}
        </div>
      )}
    </div>
  )
}
