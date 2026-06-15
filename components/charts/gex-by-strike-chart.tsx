"use client"

import { useMemo, useRef, useEffect, useState } from "react"
import * as d3 from "d3"
import type { OptionData } from "@/lib/types"
import {
  computeGEXByStrike,
  computeVolumeByStrike,
  findZeroGammaLevel,
  computeVannaByStrike,
  computeCharmByStrike,
  type PricingMethod
} from "@/lib/calculations"
import { colors, typography } from "@/lib/design-tokens"
import {
  styleAxis,
  drawGridLinesX,
  drawHorizontalRefLine,
  gexFillColor,
  gexColor,
  formatBillions,
  formatCompact,
  HORIZONTAL_MARGINS,
} from "@/lib/d3-helpers"
import { PricingMethodToggle } from "../pricing-method-toggle"

interface GEXByStrikeChartProps {
  startData: OptionData[] | null
  endData: OptionData[] | null
  ticker: string
  startSpotPrice: number
  endSpotPrice: number
  selectedExpiries: string[]
  pricingMethod: PricingMethod
  onPricingMethodChange: (method: PricingMethod) => void
  market?: 'USA' | 'INDIA'
}

export function GEXByStrikeChart({
  startData,
  endData,
  ticker,
  startSpotPrice,
  endSpotPrice,
  selectedExpiries,
  pricingMethod,
  onPricingMethodChange,
  market = 'USA',
}: GEXByStrikeChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const volSvgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [greekMode, setGreekMode] = useState<'gamma' | 'vanna' | 'charm'>('gamma')
  const [showAbsoluteGEX, setShowAbsoluteGEX] = useState(false)
  const [showVolumeChart, setShowVolumeChart] = useState(true)
  const [activeZoom, setActiveZoom] = useState<number | null>(null)
  const [dims, setDims] = useState({ width: 800, height: 600 })

  const [ratesInfo, setRatesInfo] = useState({
    usRiskFreeRate: 0.05,
    indiaRiskFreeRate: 0.065,
    source: "Assumed Defaults (Fallback)"
  })

  // Dynamic risk-free rate fetching
  useEffect(() => {
    fetch('/api/rates')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setRatesInfo({
            usRiskFreeRate: data.usRiskFreeRate,
            indiaRiskFreeRate: data.indiaRiskFreeRate,
            source: data.source
          })
        }
      })
      .catch(err => console.error("Error loading risk-free rates:", err))
  }, [])

  const effectivePricingMethod = market === 'INDIA' ? 'black-scholes' : pricingMethod
  const activeR = market === 'INDIA' ? ratesInfo.indiaRiskFreeRate : ratesInfo.usRiskFreeRate
  const activeQ = market === 'INDIA' ? 0.012 : 0.013

  // 1. Set default zoom based on ticker: 1% for SPX/SPY, 2% for others
  useEffect(() => {
    if (ticker === 'SPX' || ticker === 'SPY') {
      setActiveZoom(1)
    } else {
      setActiveZoom(2)
    }
  }, [ticker])

  // Filter data by selected expiries
  const startFilteredData = useMemo(() => {
    if (!startData) return []
    if (selectedExpiries.length === 0) return startData
    return startData.filter(o => selectedExpiries.includes(o.expiration.toISOString().split("T")[0]))
  }, [startData, selectedExpiries])

  const endFilteredData = useMemo(() => {
    if (!endData) return []
    if (selectedExpiries.length === 0) return endData
    return endData.filter(o => selectedExpiries.includes(o.expiration.toISOString().split("T")[0]))
  }, [endData, selectedExpiries])

  const selectedExpiryLabel = selectedExpiries.length === 0
    ? "All Expiries"
    : selectedExpiries.length === 1
      ? selectedExpiries[0]
      : `${selectedExpiries.length} Expiries`

  // Compute GEX and volume for start data
  const startGexByStrike = useMemo(() => computeGEXByStrike(startSpotPrice, startFilteredData, effectivePricingMethod), [startSpotPrice, startFilteredData, effectivePricingMethod])
  const startVolumeByStrike = useMemo(() => computeVolumeByStrike(startFilteredData), [startFilteredData])
  const startVannaByStrike = useMemo(() => computeVannaByStrike(startSpotPrice, startFilteredData, activeR, activeQ, effectivePricingMethod), [startSpotPrice, startFilteredData, activeR, activeQ, effectivePricingMethod])
  const startCharmByStrike = useMemo(() => computeCharmByStrike(startSpotPrice, startFilteredData, activeR, activeQ, effectivePricingMethod), [startSpotPrice, startFilteredData, activeR, activeQ, effectivePricingMethod])

  // Compute GEX and volume for end data
  const endGexByStrike = useMemo(() => computeGEXByStrike(endSpotPrice, endFilteredData, effectivePricingMethod), [endSpotPrice, endFilteredData, effectivePricingMethod])
  const endVolumeByStrike = useMemo(() => computeVolumeByStrike(endFilteredData), [endFilteredData])
  const endVannaByStrike = useMemo(() => computeVannaByStrike(endSpotPrice, endFilteredData, activeR, activeQ, effectivePricingMethod), [endSpotPrice, endFilteredData, activeR, activeQ, effectivePricingMethod])
  const endCharmByStrike = useMemo(() => computeCharmByStrike(endSpotPrice, endFilteredData, activeR, activeQ, effectivePricingMethod), [endSpotPrice, endFilteredData, activeR, activeQ, effectivePricingMethod])

  const zeroGammaLevel = useMemo(() => findZeroGammaLevel(endFilteredData.length ? endFilteredData : startFilteredData, endSpotPrice || startSpotPrice), [startFilteredData, endFilteredData, startSpotPrice, endSpotPrice])

  // Merge strikes
  const allStrikes = useMemo(() => Array.from(new Set([
    ...startGexByStrike.map(item => item.strike),
    ...endGexByStrike.map(item => item.strike),
    ...startVolumeByStrike.map(item => item.strike),
    ...endVolumeByStrike.map(item => item.strike)
  ])).sort((a, b) => a - b), [startGexByStrike, endGexByStrike, startVolumeByStrike, endVolumeByStrike])

  const refSpot = endSpotPrice || startSpotPrice || 100

  // Filter scrollable strikes to ±15% range around spot price
  const scrollableStrikes = useMemo(() => {
    return allStrikes.filter(s => s >= refSpot * 0.85 && s <= refSpot * 1.15)
  }, [allStrikes, refSpot])

  // ATM strike
  const atmStrike = useMemo(() => {
    if (scrollableStrikes.length === 0) return refSpot
    return scrollableStrikes.reduce((prev, curr) => Math.abs(curr - refSpot) < Math.abs(prev - refSpot) ? curr : prev, scrollableStrikes[0])
  }, [scrollableStrikes, refSpot])

  // Map to scrollable strikes (pre-computed values)
  const startGammaValues = useMemo(() => scrollableStrikes.map(s => startGexByStrike.find(i => i.strike === s)?.gex || 0), [scrollableStrikes, startGexByStrike])
  const endGammaValues = useMemo(() => scrollableStrikes.map(s => endGexByStrike.find(i => i.strike === s)?.gex || 0), [scrollableStrikes, endGexByStrike])

  const startVannaValues = useMemo(() => scrollableStrikes.map(s => startVannaByStrike.find(i => i.strike === s)?.vanna || 0), [scrollableStrikes, startVannaByStrike])
  const endVannaValues = useMemo(() => scrollableStrikes.map(s => endVannaByStrike.find(i => i.strike === s)?.vanna || 0), [scrollableStrikes, endVannaByStrike])

  const startCharmValues = useMemo(() => scrollableStrikes.map(s => startCharmByStrike.find(i => i.strike === s)?.charm || 0), [scrollableStrikes, startCharmByStrike])
  const endCharmValues = useMemo(() => scrollableStrikes.map(s => endCharmByStrike.find(i => i.strike === s)?.charm || 0), [scrollableStrikes, endCharmByStrike])

  const startVolumeValues = useMemo(() => scrollableStrikes.map(s => startVolumeByStrike.find(i => i.strike === s)?.volume || 0), [scrollableStrikes, startVolumeByStrike])
  const endVolumeValues = useMemo(() => scrollableStrikes.map(s => endVolumeByStrike.find(i => i.strike === s)?.volume || 0), [scrollableStrikes, endVolumeByStrike])

  // Absolute GEX
  const { startCallGEX, startPutGEX } = useMemo(() => {
    const startCallGEX = scrollableStrikes.map(strike => {
      const callOptions = startFilteredData.filter(o => o.strike === strike && o.type === "C")
      let gex = 0
      callOptions.forEach(o => { if (o.GEX_BS) gex += Math.abs(o.GEX_BS) })
      return gex / 1e9
    })
    const startPutGEX = scrollableStrikes.map(strike => {
      const putOptions = startFilteredData.filter(o => o.strike === strike && o.type === "P")
      let gex = 0
      putOptions.forEach(o => { if (o.GEX_BS) gex += Math.abs(o.GEX_BS) })
      return -gex / 1e9
    })
    return { startCallGEX, startPutGEX }
  }, [scrollableStrikes, startFilteredData])

  const { endCallGEX, endPutGEX } = useMemo(() => {
    const endCallGEX = scrollableStrikes.map(strike => {
      const callOptions = endFilteredData.filter(o => o.strike === strike && o.type === "C")
      let gex = 0
      callOptions.forEach(o => { if (o.GEX_BS) gex += Math.abs(o.GEX_BS) })
      return gex / 1e9
    })
    const endPutGEX = scrollableStrikes.map(strike => {
      const putOptions = endFilteredData.filter(o => o.strike === strike && o.type === "P")
      let gex = 0
      putOptions.forEach(o => { if (o.GEX_BS) gex += Math.abs(o.GEX_BS) })
      return -gex / 1e9
    })
    return { endCallGEX, endPutGEX }
  }, [scrollableStrikes, endFilteredData])

  // Zoom range constraints to compute the x-axis scale range
  const xDomain = useMemo<[number, number]>(() => {
    const zoomPct = activeZoom || 10
    const range = atmStrike * (zoomPct / 100)
    
    const zoomStrikes = scrollableStrikes.filter(s => s >= atmStrike - range && s <= atmStrike + range)
    if (zoomStrikes.length === 0) return [-1, 1]

    if (showAbsoluteGEX && greekMode === 'gamma') {
      const maxStartCall = d3.max(zoomStrikes.map(s => {
        const idx = scrollableStrikes.indexOf(s)
        return idx !== -1 ? Math.abs(startCallGEX[idx]) : 0
      })) || 0
      const maxEndCall = d3.max(zoomStrikes.map(s => {
        const idx = scrollableStrikes.indexOf(s)
        return idx !== -1 ? Math.abs(endCallGEX[idx]) : 0
      })) || 0

      const maxStartPut = d3.max(zoomStrikes.map(s => {
        const idx = scrollableStrikes.indexOf(s)
        return idx !== -1 ? Math.abs(startPutGEX[idx]) : 0
      })) || 0
      const maxEndPut = d3.max(zoomStrikes.map(s => {
        const idx = scrollableStrikes.indexOf(s)
        return idx !== -1 ? Math.abs(endPutGEX[idx]) : 0
      })) || 0

      const maxVal = Math.max(maxStartCall, maxEndCall, maxStartPut, maxEndPut) * 1.15 || 1
      return [-maxVal, maxVal]
    } else {
      let maxNet = 1
      if (greekMode === 'gamma') {
        const mStart = d3.max(zoomStrikes.map(s => {
          const idx = scrollableStrikes.indexOf(s)
          return idx !== -1 ? Math.abs(startGammaValues[idx]) : 0
        })) || 0
        const mEnd = d3.max(zoomStrikes.map(s => {
          const idx = scrollableStrikes.indexOf(s)
          return idx !== -1 ? Math.abs(endGammaValues[idx]) : 0
        })) || 0
        maxNet = Math.max(mStart, mEnd)
      } else if (greekMode === 'vanna') {
        const mStart = d3.max(zoomStrikes.map(s => {
          const idx = scrollableStrikes.indexOf(s)
          return idx !== -1 ? Math.abs(startVannaValues[idx]) : 0
        })) || 0
        const mEnd = d3.max(zoomStrikes.map(s => {
          const idx = scrollableStrikes.indexOf(s)
          return idx !== -1 ? Math.abs(endVannaValues[idx]) : 0
        })) || 0
        maxNet = Math.max(mStart, mEnd)
      } else if (greekMode === 'charm') {
        const mStart = d3.max(zoomStrikes.map(s => {
          const idx = scrollableStrikes.indexOf(s)
          return idx !== -1 ? Math.abs(startCharmValues[idx]) : 0
        })) || 0
        const mEnd = d3.max(zoomStrikes.map(s => {
          const idx = scrollableStrikes.indexOf(s)
          return idx !== -1 ? Math.abs(endCharmValues[idx]) : 0
        })) || 0
        maxNet = Math.max(mStart, mEnd)
      }
      const maxVal = (maxNet || 1) * 1.15
      return [-maxVal, maxVal]
    }
  }, [scrollableStrikes, activeZoom, atmStrike, showAbsoluteGEX, greekMode, startCallGEX, endCallGEX, startPutGEX, endPutGEX, startGammaValues, endGammaValues, startVannaValues, endVannaValues, startCharmValues, endCharmValues])

  // Auto-scroll to center ATM strike
  useEffect(() => {
    if (!scrollContainerRef.current || !refSpot || scrollableStrikes.length === 0) return

    const atmIndex = [...scrollableStrikes].reverse().findIndex(s => s === atmStrike)
    if (atmIndex !== -1) {
      const barHeight = 22
      const margin = HORIZONTAL_MARGINS
      const yPos = margin.top + atmIndex * barHeight
      const containerHeight = scrollContainerRef.current.clientHeight || 500
      scrollContainerRef.current.scrollTop = yPos - containerHeight / 2
    }
  }, [refSpot, scrollableStrikes, atmStrike])

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

  // Fixed height per bar for perfect readability & scrolling
  const barHeight = 22
  const chartHeight = scrollableStrikes.length * barHeight

  // Color helper functions
  const getNormalFill = (val: number, mode: 'gamma' | 'vanna' | 'charm', isEnd: boolean) => {
    const opacity = isEnd ? 0.75 : 0.25
    if (mode === 'gamma') {
      return gexFillColor(val).replace('0.75', String(opacity)).replace('0.3', String(opacity * 0.4))
    }
    return val >= 0 
      ? `rgba(0, 200, 5, ${opacity})`
      : `rgba(255, 59, 96, ${opacity})`
  }

  const getNormalStroke = (val: number, mode: 'gamma' | 'vanna' | 'charm') => {
    if (mode === 'gamma') return gexColor(val)
    return val >= 0 ? '#00C805' : '#FF3B60'
  }

  // ─── D3 Gamma Chart ──────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || scrollableStrikes.length === 0) return

    const chartWidth = showVolumeChart ? dims.width / 2 - 8 : dims.width
    const margin = HORIZONTAL_MARGINS
    const width = chartWidth - margin.left - margin.right
    if (width <= 0 || chartHeight <= 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', chartWidth).attr('height', chartHeight + margin.top + margin.bottom)

    // Append definitions for striped patterns
    const defs = svg.append('defs')
    
    defs.append('pattern')
      .attr('id', 'increase-stripes')
      .attr('width', 8)
      .attr('height', 8)
      .attr('patternUnits', 'userSpaceOnUse')
      .append('path')
      .attr('d', 'M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6')
      .attr('stroke', '#00C805')
      .attr('stroke-width', 1.8)
      .attr('fill', 'none')
      
    defs.append('pattern')
      .attr('id', 'decrease-stripes')
      .attr('width', 8)
      .attr('height', 8)
      .attr('patternUnits', 'userSpaceOnUse')
      .append('path')
      .attr('d', 'M-2,6 L6,-2 M0,0 L8,8 M2,10 L10,2')
      .attr('stroke', '#FF3B60')
      .attr('stroke-width', 1.8)
      .attr('fill', 'none')

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Scales
    const yScale = d3.scaleBand()
      .domain([...scrollableStrikes].reverse().map(String))
      .range([0, chartHeight])
      .padding(0.15)

    const xScale = d3.scaleLinear().domain(xDomain).range([0, width])

    // Grid
    drawGridLinesX(g, xScale, chartHeight, 8)

    // Zero line
    g.append('line')
      .attr('x1', xScale(0)).attr('x2', xScale(0))
      .attr('y1', 0).attr('y2', chartHeight)
      .attr('stroke', '#2A2A2A').attr('stroke-width', 1)

    // Prepare range-based datasets for D3
    const startValues = greekMode === 'gamma' ? startGammaValues : greekMode === 'vanna' ? startVannaValues : startCharmValues
    const endValues = greekMode === 'gamma' ? endGammaValues : greekMode === 'vanna' ? endVannaValues : endCharmValues

    const barsData = scrollableStrikes.map((strike, i) => {
      if (showAbsoluteGEX && greekMode === 'gamma') {
        return {
          strike,
          startCall: startCallGEX[i],
          endCall: endCallGEX[i],
          deltaCall: endCallGEX[i] - startCallGEX[i],
          startPut: startPutGEX[i],
          endPut: endPutGEX[i],
          deltaPut: endPutGEX[i] - startPutGEX[i],
          isAbsolute: true
        }
      } else {
        const startVal = startValues[i]
        const endVal = endValues[i]
        return {
          strike,
          startVal,
          endVal,
          delta: endVal - startVal,
          isAbsolute: false
        }
      }
    })

    // Bars
    if (showAbsoluteGEX && greekMode === 'gamma') {
      const absData = barsData.filter(d => d.isAbsolute) as {
        strike: number
        startCall: number
        endCall: number
        deltaCall: number
        startPut: number
        endPut: number
        deltaPut: number
        isAbsolute: boolean
      }[]

      // Call start bars
      g.selectAll('.bar-call-start')
        .data(absData, (d: any) => d.strike)
        .join(
          enter => enter.append('rect')
            .attr('class', 'bar-call-start')
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.startCall, 0)))
            .attr('width', d => Math.abs(xScale(d.startCall) - xScale(0)))
            .attr('fill', colors.accentAlpha.green50)
            .attr('stroke', colors.accent.green)
            .attr('stroke-width', 0.5)
            .attr('rx', 1)
            .style('opacity', 0.25),
          update => update.call(u => u.transition().duration(400)
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.startCall, 0)))
            .attr('width', d => Math.abs(xScale(d.startCall) - xScale(0)))
          )
        )

      // Call end bars
      g.selectAll('.bar-call-end')
        .data(absData, (d: any) => d.strike)
        .join(
          enter => enter.append('rect')
            .attr('class', 'bar-call-end')
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.endCall, 0)))
            .attr('width', d => Math.abs(xScale(d.endCall) - xScale(0)))
            .attr('fill', colors.accentAlpha.green50)
            .attr('stroke', colors.accent.green)
            .attr('stroke-width', 0.5)
            .attr('rx', 1)
            .style('opacity', 0.8),
          update => update.call(u => u.transition().duration(400)
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.endCall, 0)))
            .attr('width', d => Math.abs(xScale(d.endCall) - xScale(0)))
          )
        )

      // Call change bars (striped)
      g.selectAll('.bar-call-change')
        .data(absData, (d: any) => d.strike)
        .join(
          enter => enter.append('rect')
            .attr('class', 'bar-call-change')
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.startCall, d.endCall)))
            .attr('width', d => Math.abs(xScale(d.endCall) - xScale(d.startCall)))
            .attr('fill', d => d.deltaCall >= 0 ? 'url(#increase-stripes)' : 'url(#decrease-stripes)')
            .attr('stroke', d => d.deltaCall >= 0 ? '#00C805' : '#FF3B60')
            .attr('stroke-width', 0.5)
            .attr('rx', 1)
            .style('opacity', 0.95),
          update => update.call(u => u.transition().duration(400)
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.startCall, d.endCall)))
            .attr('width', d => Math.abs(xScale(d.endCall) - xScale(d.startCall)))
            .attr('fill', d => d.deltaCall >= 0 ? 'url(#increase-stripes)' : 'url(#decrease-stripes)')
            .attr('stroke', d => d.deltaCall >= 0 ? '#00C805' : '#FF3B60')
          )
        )

      // Put start bars
      g.selectAll('.bar-put-start')
        .data(absData, (d: any) => d.strike)
        .join(
          enter => enter.append('rect')
            .attr('class', 'bar-put-start')
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.startPut, 0)))
            .attr('width', d => Math.abs(xScale(d.startPut) - xScale(0)))
            .attr('fill', colors.accentAlpha.red50)
            .attr('stroke', colors.accent.red)
            .attr('stroke-width', 0.5)
            .attr('rx', 1)
            .style('opacity', 0.25),
          update => update.call(u => u.transition().duration(400)
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.startPut, 0)))
            .attr('width', d => Math.abs(xScale(d.startPut) - xScale(0)))
          )
        )

      // Put end bars
      g.selectAll('.bar-put-end')
        .data(absData, (d: any) => d.strike)
        .join(
          enter => enter.append('rect')
            .attr('class', 'bar-put-end')
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.endPut, 0)))
            .attr('width', d => Math.abs(xScale(d.endPut) - xScale(0)))
            .attr('fill', colors.accentAlpha.red50)
            .attr('stroke', colors.accent.red)
            .attr('stroke-width', 0.5)
            .attr('rx', 1)
            .style('opacity', 0.8),
          update => update.call(u => u.transition().duration(400)
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.endPut, 0)))
            .attr('width', d => Math.abs(xScale(d.endPut) - xScale(0)))
          )
        )

      // Put change bars (striped)
      g.selectAll('.bar-put-change')
        .data(absData, (d: any) => d.strike)
        .join(
          enter => enter.append('rect')
            .attr('class', 'bar-put-change')
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.startPut, d.endPut)))
            .attr('width', d => Math.abs(xScale(d.endPut) - xScale(d.startPut)))
            .attr('fill', d => d.deltaPut >= 0 ? 'url(#increase-stripes)' : 'url(#decrease-stripes)')
            .attr('stroke', d => d.deltaPut >= 0 ? '#00C805' : '#FF3B60')
            .attr('stroke-width', 0.5)
            .attr('rx', 1)
            .style('opacity', 0.95),
          update => update.call(u => u.transition().duration(400)
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.startPut, d.endPut)))
            .attr('width', d => Math.abs(xScale(d.endPut) - xScale(d.startPut)))
            .attr('fill', d => d.deltaPut >= 0 ? 'url(#increase-stripes)' : 'url(#decrease-stripes)')
            .attr('stroke', d => d.deltaPut >= 0 ? '#00C805' : '#FF3B60')
          )
        )

    } else {
      const netData = barsData.filter(d => !d.isAbsolute) as {
        strike: number
        startVal: number
        endVal: number
        delta: number
        isAbsolute: boolean
      }[]

      // Net Start bars (Solid, semi-transparent)
      g.selectAll('.bar-net-start')
        .data(netData, (d: any) => d.strike)
        .join(
          enter => enter.append('rect')
            .attr('class', 'bar-net-start')
            .attr('y', d => yScale(String(d.strike))!)
            .attr('x', d => xScale(Math.min(d.startVal, 0)))
            .attr('width', d => Math.abs(xScale(d.startVal) - xScale(0)))
            .attr('height', yScale.bandwidth())
            .attr('fill', d => getNormalFill(d.startVal, greekMode, false))
            .attr('stroke', d => getNormalStroke(d.startVal, greekMode))
            .attr('stroke-width', 0.5)
            .attr('rx', 1)
            .style('opacity', 0.35),
          update => update.call(u => u.transition().duration(400)
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.startVal, 0)))
            .attr('width', d => Math.abs(xScale(d.startVal) - xScale(0)))
            .attr('fill', d => getNormalFill(d.startVal, greekMode, false))
            .attr('stroke', d => getNormalStroke(d.startVal, greekMode))
          )
        )

      // Net End bars (Solid, fully opaque)
      g.selectAll('.bar-net-end')
        .data(netData, (d: any) => d.strike)
        .join(
          enter => enter.append('rect')
            .attr('class', 'bar-net-end')
            .attr('y', d => yScale(String(d.strike))!)
            .attr('x', d => xScale(Math.min(d.endVal, 0)))
            .attr('width', d => Math.abs(xScale(d.endVal) - xScale(0)))
            .attr('height', yScale.bandwidth())
            .attr('fill', d => getNormalFill(d.endVal, greekMode, true))
            .attr('stroke', d => getNormalStroke(d.endVal, greekMode))
            .attr('stroke-width', 0.5)
            .attr('rx', 1)
            .style('opacity', 0.8),
          update => update.call(u => u.transition().duration(400)
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.endVal, 0)))
            .attr('width', d => Math.abs(xScale(d.endVal) - xScale(0)))
            .attr('fill', d => getNormalFill(d.endVal, greekMode, true))
            .attr('stroke', d => getNormalStroke(d.endVal, greekMode))
          )
        )

      // Net Change bars (Striped)
      g.selectAll('.bar-net-change')
        .data(netData, (d: any) => d.strike)
        .join(
          enter => enter.append('rect')
            .attr('class', 'bar-net-change')
            .attr('y', d => yScale(String(d.strike))!)
            .attr('x', d => xScale(Math.min(d.startVal, d.endVal)))
            .attr('width', d => Math.abs(xScale(d.endVal) - xScale(d.startVal)))
            .attr('height', yScale.bandwidth())
            .attr('fill', d => d.delta >= 0 ? 'url(#increase-stripes)' : 'url(#decrease-stripes)')
            .attr('stroke', d => d.delta >= 0 ? '#00C805' : '#FF3B60')
            .attr('stroke-width', 0.5)
            .attr('rx', 1)
            .style('opacity', 0.95),
          update => update.call(u => u.transition().duration(400)
            .attr('y', d => yScale(String(d.strike))!)
            .attr('height', yScale.bandwidth())
            .attr('x', d => xScale(Math.min(d.startVal, d.endVal)))
            .attr('width', d => Math.abs(xScale(d.endVal) - xScale(d.startVal)))
            .attr('fill', d => d.delta >= 0 ? 'url(#increase-stripes)' : 'url(#decrease-stripes)')
            .attr('stroke', d => d.delta >= 0 ? '#00C805' : '#FF3B60')
          )
        )
    }

    // Spot price reference lines
    const getClosestStrike = (val: number) => scrollableStrikes.reduce((prev, curr) =>
      Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev, scrollableStrikes[0])

    const startSpotYStr = String(getClosestStrike(startSpotPrice))
    const startSpotY = yScale(startSpotYStr)
    if (startSpotY !== undefined && startSpotPrice > 0 && Math.abs(startSpotPrice - endSpotPrice) > 1) {
      drawHorizontalRefLine(g, startSpotY + yScale.bandwidth() / 2, width, 'rgba(245, 158, 11, 0.45)', `START SPOT ${startSpotPrice.toFixed(0)}`, { dashArray: '2,2' })
    }

    const endSpotYStr = String(getClosestStrike(endSpotPrice))
    const endSpotY = yScale(endSpotYStr)
    if (endSpotY !== undefined && endSpotPrice > 0) {
      drawHorizontalRefLine(g, endSpotY + yScale.bandwidth() / 2, width, colors.accent.amber, `SPOT ${endSpotPrice.toFixed(0)}`)
    }

    // Gamma flip reference line (only in Gamma mode)
    if (greekMode === 'gamma' && zeroGammaLevel) {
      const flipStr = String(getClosestStrike(zeroGammaLevel))
      const flipY = yScale(flipStr)
      if (flipY !== undefined) {
        drawHorizontalRefLine(g, flipY + yScale.bandwidth() / 2, width, colors.accent.magenta, `GAMMA FLIP ${zeroGammaLevel.toFixed(0)}`, { dashArray: '4,4' })
      }
    }

    // Axes
    const yAxis = d3.axisLeft(yScale).tickSize(0)
    const yAxisG = g.append('g').call(yAxis)
    styleAxis(yAxisG, { fontSize: 10 })

    const xAxis = d3.axisBottom(xScale).ticks(6).tickFormat(d => formatBillions(d as number))
    const xAxisG = g.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis)
    styleAxis(xAxisG)

    // X-axis label
    g.append('text')
      .attr('x', width / 2).attr('y', chartHeight + 36)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans)
      .style('font-size', '11px')
      .text(
        greekMode === 'gamma'
          ? (showAbsoluteGEX ? 'Gamma (Calls → | ← Puts)' : 'Net Gamma')
          : (greekMode === 'vanna' ? 'Net Vanna (VEX)' : 'Net Charm (CEX)')
      )

    // Title / Header
    const titleText = greekMode === 'gamma'
      ? `${ticker} ${showAbsoluteGEX ? 'Absolute' : 'Net'} Gamma by Strike (${selectedExpiryLabel})`
      : greekMode === 'vanna'
        ? `${ticker} Net Vanna by Strike (${selectedExpiryLabel})`
        : `${ticker} Net Charm by Strike (${selectedExpiryLabel})`

    svg.append('text')
      .attr('x', margin.left + width / 2).attr('y', 16)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '12px')
      .style('font-weight', '700')
      .text(titleText)

    // Hover interactions
    const hoverLine = g.append('line')
      .attr('stroke', '#444').attr('stroke-width', 1).attr('stroke-dasharray', '3,3')
      .attr('x1', 0).attr('x2', width).attr('y1', 0).attr('y2', 0)
      .style('opacity', 0).style('pointer-events', 'none')

    g.append('rect')
      .attr('width', width).attr('height', chartHeight)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent) => {
        const [, my] = d3.pointer(event)
        const bandStep = yScale.step()
        const idx = Math.floor(my / bandStep)
        if (idx < 0 || idx >= scrollableStrikes.length) return

        const domain = yScale.domain()
        const strikeStr = domain[idx]
        const strikeIdx = scrollableStrikes.findIndex(s => String(s) === strikeStr)
        if (strikeIdx === -1) return

        hoverLine
          .attr('y1', yScale(strikeStr)! + yScale.bandwidth() / 2)
          .attr('y2', yScale(strikeStr)! + yScale.bandwidth() / 2)
          .style('opacity', 1)

        if (tooltipRef.current && containerRef.current) {
          const strike = scrollableStrikes[strikeIdx]
          let html = `
            <div style="font-family:${typography.fontSans};font-size:12px;color:${colors.text.primary};font-weight:600">
              Strike ${strike.toFixed(0)}
            </div>
          `
          if (greekMode === 'gamma') {
            if (showAbsoluteGEX) {
              const sCall = startCallGEX[strikeIdx]
              const eCall = endCallGEX[strikeIdx]
              const dCall = eCall - sCall
              const sPut = startPutGEX[strikeIdx]
              const ePut = endPutGEX[strikeIdx]
              const dPut = ePut - sPut
              html += `
                <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.text.secondary};margin-top:4px">
                  Call: ${sCall.toFixed(3)}B → ${eCall.toFixed(3)}B (<span style="color:${dCall >= 0 ? '#00C805' : '#FF3B60'}">${dCall >= 0 ? '+' : ''}${dCall.toFixed(3)}B</span>)
                </div>
                <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.text.secondary};margin-top:2px">
                  Put: ${sPut.toFixed(3)}B → ${ePut.toFixed(3)}B (<span style="color:${dPut >= 0 ? '#00C805' : '#FF3B60'}">${dPut >= 0 ? '+' : ''}${dPut.toFixed(3)}B</span>)
                </div>
              `
            } else {
              const sG = startGammaValues[strikeIdx]
              const eG = endGammaValues[strikeIdx]
              const dG = eG - sG
              html += `
                <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.text.secondary};margin-top:4px">
                  Net GEX: ${sG.toFixed(3)}B → ${eG.toFixed(3)}B (<span style="color:${dG >= 0 ? '#00C805' : '#FF3B60'}">${dG >= 0 ? '+' : ''}${dG.toFixed(3)}B</span>)
                </div>
              `
            }
          } else if (greekMode === 'vanna') {
            const sV = startVannaValues[strikeIdx]
            const eV = endVannaValues[strikeIdx]
            const dV = eV - sV
            html += `
              <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.text.secondary};margin-top:4px">
                Net Vanna: ${sV.toFixed(3)}B → ${eV.toFixed(3)}B (<span style="color:${dV >= 0 ? '#00C805' : '#FF3B60'}">${dV >= 0 ? '+' : ''}${dV.toFixed(3)}B</span>)
              </div>
            `
          } else if (greekMode === 'charm') {
            const sC = startCharmValues[strikeIdx]
            const eC = endCharmValues[strikeIdx]
            const dC = eC - sC
            html += `
              <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.text.secondary};margin-top:4px">
                Net Charm: ${sC.toFixed(3)}B → ${eC.toFixed(3)}B (<span style="color:${dC >= 0 ? '#00C805' : '#FF3B60'}">${dC >= 0 ? '+' : ''}${dC.toFixed(3)}B</span>)
              </div>
            `
          }
          tooltipRef.current.innerHTML = html
          const rect = containerRef.current.getBoundingClientRect()
          const cx = event.clientX - rect.left
          const cy = event.clientY - rect.top
          tooltipRef.current.style.left = `${cx + 14}px`
          tooltipRef.current.style.top = `${cy - 20}px`
          tooltipRef.current.style.opacity = '1'
        }
      })
      .on('mouseleave', () => {
        hoverLine.style('opacity', 0)
        if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
      })

  }, [scrollableStrikes, startGammaValues, endGammaValues, startVannaValues, endVannaValues, startCharmValues, endCharmValues, startCallGEX, endCallGEX, startPutGEX, endPutGEX, showAbsoluteGEX, greekMode, dims, showVolumeChart, startSpotPrice, endSpotPrice, zeroGammaLevel, ticker, selectedExpiryLabel, xDomain])

  // ─── D3 Volume Chart ─────────────────────────────────────────
  useEffect(() => {
    if (!volSvgRef.current || !showVolumeChart || scrollableStrikes.length === 0) return

    const chartWidth = dims.width / 2 - 8
    const margin = HORIZONTAL_MARGINS
    const width = chartWidth - margin.left - margin.right
    if (width <= 0 || chartHeight <= 0) return

    const svg = d3.select(volSvgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', chartWidth).attr('height', chartHeight + margin.top + margin.bottom)

    // Add patterns definition
    const defs = svg.append('defs')
    
    defs.append('pattern')
      .attr('id', 'increase-stripes-vol')
      .attr('width', 8)
      .attr('height', 8)
      .attr('patternUnits', 'userSpaceOnUse')
      .append('path')
      .attr('d', 'M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6')
      .attr('stroke', '#00C805')
      .attr('stroke-width', 1.8)
      .attr('fill', 'none')
      
    defs.append('pattern')
      .attr('id', 'decrease-stripes-vol')
      .attr('width', 8)
      .attr('height', 8)
      .attr('patternUnits', 'userSpaceOnUse')
      .append('path')
      .attr('d', 'M-2,6 L6,-2 M0,0 L8,8 M2,10 L10,2')
      .attr('stroke', '#FF3B60')
      .attr('stroke-width', 1.8)
      .attr('fill', 'none')

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const yScale = d3.scaleBand()
      .domain([...scrollableStrikes].reverse().map(String))
      .range([0, chartHeight])
      .padding(0.15)

    const maxVol = Math.max(d3.max(startVolumeValues) || 0, d3.max(endVolumeValues) || 0, 1) * 1.15
    const xScale = d3.scaleLinear().domain([0, maxVol]).range([0, width])

    // Grid
    drawGridLinesX(g, xScale, chartHeight, 6)

    const volumeData = scrollableStrikes.map((strike, i) => {
      const startV = startVolumeValues[i]
      const endV = endVolumeValues[i]
      return {
        strike,
        startV,
        endV,
        delta: endV - startV
      }
    })

    // Volume Start Bars (Solid, semi-transparent)
    g.selectAll('.bar-vol-start')
      .data(volumeData, (d: any) => d.strike)
      .join(
        enter => enter.append('rect')
          .attr('class', 'bar-vol-start')
          .attr('y', d => yScale(String(d.strike))!)
          .attr('height', yScale.bandwidth())
          .attr('x', 0)
          .attr('width', d => xScale(d.startV))
          .attr('fill', colors.accentAlpha.cyan40)
          .attr('stroke', colors.accent.cyan)
          .attr('stroke-width', 0.5)
          .attr('rx', 1)
          .style('opacity', 0.25),
        update => update.call(u => u.transition().duration(400)
          .attr('y', d => yScale(String(d.strike))!)
          .attr('height', yScale.bandwidth())
          .attr('x', 0)
          .attr('width', d => xScale(d.startV))
        )
      )

    // Volume End Bars (Solid, fully opaque)
    g.selectAll('.bar-vol-end')
      .data(volumeData, (d: any) => d.strike)
      .join(
        enter => enter.append('rect')
          .attr('class', 'bar-vol-end')
          .attr('y', d => yScale(String(d.strike))!)
          .attr('height', yScale.bandwidth())
          .attr('x', 0)
          .attr('width', d => xScale(d.endV))
          .attr('fill', colors.accentAlpha.cyan40)
          .attr('stroke', colors.accent.cyan)
          .attr('stroke-width', 0.5)
          .attr('rx', 1)
          .style('opacity', 0.8),
        update => update.call(u => u.transition().duration(400)
          .attr('y', d => yScale(String(d.strike))!)
          .attr('height', yScale.bandwidth())
          .attr('x', 0)
          .attr('width', d => xScale(d.endV))
        )
      )

    // Volume Change Bars (Striped)
    g.selectAll('.bar-vol-change')
      .data(volumeData, (d: any) => d.strike)
      .join(
        enter => enter.append('rect')
          .attr('class', 'bar-vol-change')
          .attr('y', d => yScale(String(d.strike))!)
          .attr('height', yScale.bandwidth())
          .attr('x', d => xScale(Math.min(d.startV, d.endV)))
          .attr('width', d => Math.abs(xScale(d.endV) - xScale(d.startV)))
          .attr('fill', d => d.delta >= 0 ? 'url(#increase-stripes-vol)' : 'url(#decrease-stripes-vol)')
          .attr('stroke', d => d.delta >= 0 ? '#00C805' : '#FF3B60')
          .attr('stroke-width', 0.5)
          .attr('rx', 1)
          .style('opacity', 0.95),
        update => update.call(u => u.transition().duration(400)
          .attr('y', d => yScale(String(d.strike))!)
          .attr('height', yScale.bandwidth())
          .attr('x', d => xScale(Math.min(d.startV, d.endV)))
          .attr('width', d => Math.abs(xScale(d.endV) - xScale(d.startV)))
          .attr('fill', d => d.delta >= 0 ? 'url(#increase-stripes-vol)' : 'url(#decrease-stripes-vol)')
          .attr('stroke', d => d.delta >= 0 ? '#00C805' : '#FF3B60')
        )
      )

    // Axes
    const yAxis = d3.axisLeft(yScale).tickSize(0)
    const yAxisG = g.append('g').call(yAxis)
    styleAxis(yAxisG, { fontSize: 10 })

    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d => formatCompact(d as number))
    const xAxisG = g.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis)
    styleAxis(xAxisG)

    g.append('text')
      .attr('x', width / 2).attr('y', chartHeight + 36)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.secondary)
      .style('font-family', typography.fontSans)
      .style('font-size', '11px')
      .text('Volume (Contracts)')

    svg.append('text')
      .attr('x', margin.left + width / 2).attr('y', 16)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text.primary)
      .style('font-family', typography.fontSans)
      .style('font-size', '12px')
      .style('font-weight', '700')
      .text(`${ticker} Volume by Strike`)

    // Hover interactions
    const hoverLine = g.append('line')
      .attr('stroke', '#444').attr('stroke-width', 1).attr('stroke-dasharray', '3,3')
      .attr('x1', 0).attr('x2', width).attr('y1', 0).attr('y2', 0)
      .style('opacity', 0).style('pointer-events', 'none')

    g.append('rect')
      .attr('width', width).attr('height', chartHeight)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent) => {
        const [, my] = d3.pointer(event)
        const bandStep = yScale.step()
        const idx = Math.floor(my / bandStep)
        if (idx < 0 || idx >= scrollableStrikes.length) return

        const domain = yScale.domain()
        const strikeStr = domain[idx]
        const strikeIdx = scrollableStrikes.findIndex(s => String(s) === strikeStr)
        if (strikeIdx === -1) return

        hoverLine
          .attr('y1', yScale(strikeStr)! + yScale.bandwidth() / 2)
          .attr('y2', yScale(strikeStr)! + yScale.bandwidth() / 2)
          .style('opacity', 1)

        if (tooltipRef.current && containerRef.current) {
          const strike = scrollableStrikes[strikeIdx]
          const sV = startVolumeValues[strikeIdx]
          const eV = endVolumeValues[strikeIdx]
          const dV = eV - sV
          tooltipRef.current.innerHTML = `
            <div style="font-family:${typography.fontSans};font-size:12px;color:${colors.text.primary};font-weight:600">
              Strike ${strike.toFixed(0)}
            </div>
            <div style="font-family:${typography.fontMono};font-size:11px;color:${colors.text.secondary};margin-top:4px">
              Volume: ${sV.toLocaleString()} → ${eV.toLocaleString()} (<span style="color:${dV >= 0 ? '#00C805' : '#FF3B60'}">${dV >= 0 ? '+' : ''}${dV.toLocaleString()}</span>)
            </div>
          `
          const rect = containerRef.current.getBoundingClientRect()
          const cx = event.clientX - rect.left
          const cy = event.clientY - rect.top
          tooltipRef.current.style.left = `${cx + 14}px`
          tooltipRef.current.style.top = `${cy - 20}px`
          tooltipRef.current.style.opacity = '1'
        }
      })
      .on('mouseleave', () => {
        hoverLine.style('opacity', 0)
        if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
      })

  }, [scrollableStrikes, startVolumeValues, endVolumeValues, dims, showVolumeChart, ticker, containerRef, tooltipRef])

  // Zoom controls
  const zoomPercents = [1, 2, 3, 5, 10, 20, 30]

  return (
    <div ref={containerRef} className="flex flex-col gap-3 w-full h-full overflow-hidden bg-[#0A0A0A] rounded p-3 relative">
      {/* Controls */}
      <div className="flex flex-row justify-between items-center gap-3">
        {/* Zoom pills */}
        <div className="flex flex-wrap gap-1.5">
          {zoomPercents.map(p => (
            <button
              key={p}
              className={`px-2 py-0.5 rounded text-xxs font-mono border transition-colors ${
                activeZoom === p
                  ? 'bg-[#1A1A1A] text-terminal-green border-terminal-green/30'
                  : 'bg-transparent text-[#949494] border-[#1A1A1A] hover:border-[#333]'
              }`}
              onClick={() => setActiveZoom(p)}
              type="button"
            >
              ±{p}%
            </button>
          ))}
          <button
            className={`px-2 py-0.5 rounded text-xxs font-mono border transition-colors ${
              activeZoom === null
                ? 'bg-[#1A1A1A] text-terminal-green border-terminal-green/30'
                : 'bg-transparent text-[#949494] border-[#1A1A1A] hover:border-[#333]'
            }`}
            onClick={() => setActiveZoom(null)}
            type="button"
          >
            RESET
          </button>
        </div>
        
        {/* Right controls */}
        <div className="flex items-center gap-2">
          {/* Sourced vs Assumed Rates Indicator */}
          {greekMode !== 'gamma' && (
            <div 
              className="px-2 py-1 rounded text-[9px] font-mono border bg-[#050505] text-[#888] border-[#1A1A1E] flex items-center gap-1.5"
              title={`US Risk-Free Rate: ${(ratesInfo.usRiskFreeRate * 100).toFixed(2)}% | India Repo Benchmark: ${(ratesInfo.indiaRiskFreeRate * 100).toFixed(2)}%\nSource: ${ratesInfo.source}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${ratesInfo.source.startsWith('Assumed') ? 'bg-amber-500' : 'bg-green-500 animate-pulse'}`} />
              <span className="text-white font-semibold text-[8px] tracking-wider">
                {ratesInfo.source.startsWith('Assumed') ? 'ASSUMED' : 'SOURCED'}
              </span>
              <span>r: {(activeR * 100).toFixed(2)}%</span>
            </div>
          )}

          {/* Greek Switcher Toggle Pills */}
          <div className="flex items-center gap-1 bg-black/70 backdrop-blur-md px-1 py-1 rounded border border-[#1A1A1E]">
            {['GAMMA', 'VANNA', 'CHARM'].map(mode => {
              const active = greekMode === mode.toLowerCase()
              return (
                <button
                  key={mode}
                  onClick={() => setGreekMode(mode.toLowerCase() as any)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all font-bold ${
                    active 
                      ? 'bg-terminal-green/15 text-terminal-green border border-terminal-green/30' 
                      : 'bg-transparent text-[#777] border border-transparent hover:text-white'
                  }`}
                  type="button"
                >
                  {mode}
                </button>
              )
            })}
          </div>

          {market === 'USA' ? (
            <PricingMethodToggle 
              pricingMethod={pricingMethod}
              onPricingMethodChange={onPricingMethodChange}
            />
          ) : (
            <span className="text-xxs text-[#949494] font-mono px-2 py-1 border border-[#1A1A1A] rounded">
              BLACK-SCHOLES (EUR)
            </span>
          )}
          
          {greekMode === 'gamma' && (
            <button
              className={`px-2 py-0.5 rounded text-xxs font-mono border transition-colors ${
                showAbsoluteGEX
                  ? 'text-terminal-green border-terminal-green/30'
                  : 'text-terminal-purple border-terminal-purple/30'
              }`}
              onClick={() => setShowAbsoluteGEX(!showAbsoluteGEX)}
              type="button"
            >
              {showAbsoluteGEX ? "ABS" : "NET"}
            </button>
          )}
          
          <button
            className={`px-1.5 py-0.5 rounded text-xxs font-mono border transition-colors ${
              showVolumeChart
                ? 'text-terminal-cyan border-terminal-cyan/30'
                : 'text-[#949494] border-[#1A1A1A]'
            }`}
            onClick={() => setShowVolumeChart(!showVolumeChart)}
            type="button"
            title={showVolumeChart ? "Hide Volume" : "Show Volume"}
          >
            VOL
          </button>
        </div>
      </div>
      
      {/* Scrollable wrapper for charts */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 min-h-[300px] overflow-y-auto max-h-[750px] border border-[#1A1A1A] rounded bg-black terminal-scrollbar relative"
      >
        <div className="flex gap-4 w-full">
          <div className="flex-1">
            <svg ref={svgRef} className="w-full" style={{ height: `${chartHeight + HORIZONTAL_MARGINS.top + HORIZONTAL_MARGINS.bottom}px` }} />
          </div>
          {showVolumeChart && (
            <div className="flex-1">
              <svg ref={volSvgRef} className="w-full" style={{ height: `${chartHeight + HORIZONTAL_MARGINS.top + HORIZONTAL_MARGINS.bottom}px` }} />
            </div>
          )}
        </div>
      </div>

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none z-50 px-3 py-2 rounded border transition-opacity duration-100"
        style={{
          opacity: 0,
          backgroundColor: '#111111',
          borderColor: '#1A1A1A',
        }}
      />
    </div>
  )
}
