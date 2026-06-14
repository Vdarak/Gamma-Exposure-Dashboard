"use client"

import { useEffect, useRef, useMemo, useState } from "react"
import * as d3 from "d3"
import { colors, typography } from "@/lib/design-tokens"
import type { OptionData } from "@/lib/types"
import {
  computeGEXByStrike,
  computeVolumeByStrike,
  findZeroGammaLevel,
  computeVannaByStrike,
  computeCharmByStrike,
  type PricingMethod
} from "@/lib/calculations"
import { ChevronsLeft, ChevronsRight, BarChart3, Settings2 } from "lucide-react"

function formatCompact(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(0)}k`
  return num.toString()
}

function formatBillions(num: number): string {
  const val = Math.abs(num)
  if (val >= 1000000000) return `${num >= 0 ? '+' : '−'}${(val / 1000000000).toFixed(1)}B`
  if (val >= 1000000) return `${num >= 0 ? '+' : '−'}${(val / 1000000).toFixed(1)}M`
  return `${num >= 0 ? '+' : '−'}${val.toFixed(0)}`
}

interface SyncedStrikeWorkspaceProps {
  optionData: OptionData[]
  ticker: string
  spotPrice: number
  market: 'USA' | 'INDIA'
  pricingMethod: PricingMethod
  expiryMode: string
}


export function SyncedStrikeWorkspace({
  optionData,
  ticker,
  spotPrice,
  market,
  pricingMethod,
  expiryMode,
}: SyncedStrikeWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const candleSvgRef = useRef<SVGSVGElement>(null)
  const gexSvgRef = useRef<SVGSVGElement>(null)
  const volSvgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [dimensions, setDimensions] = useState({ width: 1000, height: 500 })
  const [yDomain, setYDomain] = useState<[number, number]>([0, 0])
  const [xRange, setXRange] = useState<[number, number]>([40, 80])
  
  // Timeframe state: defaults to 1D (Daily), switches to 5m for 0DTE
  const [timeframe, setTimeframe] = useState<string>('1D')
  const [candlesData, setCandlesData] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Advanced Greek display toggle state
  const [displayMode, setDisplayMode] = useState<'gamma-vol' | 'vanna-charm'>('gamma-vol')

  // Collapsible Candlestick panel state
  const [isCandlesCollapsed, setIsCandlesCollapsed] = useState(false)

  // Risk-free rate information
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


  // Automatically update timeframe defaults when expiryMode changes
  useEffect(() => {
    if (expiryMode === '0dte') {
      setTimeframe('5m')
    } else {
      setTimeframe('1D')
    }
  }, [expiryMode])

  // Fetch actual historical candles from Yahoo Finance API
  useEffect(() => {
    let active = true
    setLoadingHistory(true)
    
    fetch(`/api/history/${ticker}?timeframe=${timeframe}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch historical chart')
        return res.json()
      })
      .then(res => {
        if (active && res.success && Array.isArray(res.candles) && res.candles.length > 0) {
          setCandlesData(res.candles)
          const len = res.candles.length
          setXRange([Math.max(0, len - 40), len])
        }
      })
      .catch(err => {
        console.warn('Unable to load real history. Falling back to mock generator.', err)
        // Clear candlesData so we fall back to mock walk
        setCandlesData([])
        setXRange([40, 80])
      })
      .finally(() => {
        if (active) setLoadingHistory(false)
      })

    return () => { active = false }
  }, [ticker, timeframe])

  const [dragState, setDragState] = useState<{
    isDragging: boolean
    isPriceScale: boolean
    startX: number
    startY: number
    initialYDomain: [number, number]
    initialXRange: [number, number]
  } | null>(null)

  // Resize listener
  useEffect(() => {
    if (!containerRef.current) return
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setDimensions({ width: Math.max(width, 600), height: Math.max(height, 400) })
      }
    })
    resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  // 1. Generate stable candlestick data based on spotPrice and selected timeframe (either real Yahoo or fallback)
  const candles = useMemo(() => {
    if (candlesData.length > 0) {
      return candlesData
    }

    // Fallback Mock Generator
    const count = 80
    const list: any[] = []
    let currentPrice = spotPrice
    const now = new Date()

    const seedString = ticker + spotPrice + timeframe
    let seed = seedString.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
    const random = () => {
      const x = Math.sin(seed++) * 10000
      return x - Math.floor(x)
    }

    let intervalMs = 24 * 60 * 60 * 1000 // default 1D
    if (timeframe === '1m') intervalMs = 1 * 60 * 1000
    else if (timeframe === '5m') intervalMs = 5 * 60 * 1000
    else if (timeframe === '15m') intervalMs = 15 * 60 * 1000
    else if (timeframe === '1W') intervalMs = 7 * 24 * 60 * 60 * 1000

    for (let i = 0; i < count; i++) {
      const date = new Date(now.getTime() - (count - 1 - i) * intervalMs)
      
      let dateStr = ''
      if (timeframe.endsWith('m')) {
        dateStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      } else {
        dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      }

      const change = (random() - 0.485) * (currentPrice * 0.003)
      const open = currentPrice - change
      const close = currentPrice
      const high = Math.max(open, close) + random() * (currentPrice * 0.0015)
      const low = Math.min(open, close) - random() * (currentPrice * 0.0015)
      const vol = Math.floor(10000 + random() * 90000)

      list.push({
        date: dateStr,
        timestamp: date.getTime(),
        open,
        high,
        low,
        close,
        volume: vol,
      })

      currentPrice = open
    }

    list.reverse()
    if (list.length > 0) {
      list[list.length - 1].close = spotPrice
    }
    return list
  }, [ticker, spotPrice, timeframe, candlesData])

  // Slice visible candles and indicator data
  const visibleCandlesData = useMemo(() => {
    return candles.slice(xRange[0], xRange[1])
  }, [candles, xRange])

  // 2. Calculate dynamic Indicators (EMA 50 only)
  const indicatorData = useMemo(() => {
    const closes = candles.map(c => c.close)

    const ema = (period: number) => {
      const vals: number[] = []
      let prevEma = closes[0]
      const multiplier = 2 / (period + 1)
      vals.push(prevEma)

      for (let i = 1; i < closes.length; i++) {
        const curEma = closes[i] * multiplier + prevEma * (1 - multiplier)
        vals.push(curEma)
        prevEma = curEma
      }
      return vals
    }

    return {
      ema50: ema(50).slice(xRange[0], xRange[1]),
    }
  }, [candles, xRange])

  // 3. Compute GEX, Volume, Vanna, and Charm profiles by strike
  const activeR = market === 'INDIA' ? ratesInfo.indiaRiskFreeRate : ratesInfo.usRiskFreeRate
  const activeQ = market === 'INDIA' ? 0.012 : 0.013 // 1.2% NIFTY dividend yield vs 1.3% SPX dividend yield

  const gexProfile = useMemo(() => {
    const raw = computeGEXByStrike(spotPrice, optionData, pricingMethod)
    return raw.sort((a, b) => a.strike - b.strike)
  }, [spotPrice, optionData, pricingMethod])

  const volProfile = useMemo(() => {
    const raw = computeVolumeByStrike(optionData)
    return raw.sort((a, b) => a.strike - b.strike)
  }, [optionData])

  const vannaProfile = useMemo(() => {
    return computeVannaByStrike(spotPrice, optionData, activeR, activeQ, pricingMethod)
  }, [spotPrice, optionData, activeR, activeQ, pricingMethod])

  const charmProfile = useMemo(() => {
    return computeCharmByStrike(spotPrice, optionData, activeR, activeQ, pricingMethod)
  }, [spotPrice, optionData, activeR, activeQ, pricingMethod])

  const zeroGamma = useMemo(() => findZeroGammaLevel(optionData, spotPrice), [optionData, spotPrice])

  // 4. Set initial domain based on Spot Price & Active Mode
  useEffect(() => {
    const activeProfile = displayMode === 'gamma-vol' ? gexProfile : vannaProfile
    const activeProfileRight = displayMode === 'gamma-vol' ? volProfile : charmProfile
    const allStrikes = Array.from(new Set([
      ...activeProfile.map(p => p.strike),
      ...activeProfileRight.map(p => p.strike),
    ])).sort((a, b) => a - b)

    if (allStrikes.length === 0) {
      const pct = expiryMode === '0dte' ? 0.025 : 0.08
      setYDomain([spotPrice * (1 - pct), spotPrice * (1 + pct)])
      return
    }

    const pct = expiryMode === '0dte' ? 0.025 : 0.08
    const zoomRange = spotPrice * pct
    setYDomain([spotPrice - zoomRange, spotPrice + zoomRange])
  }, [gexProfile, volProfile, vannaProfile, charmProfile, spotPrice, ticker, expiryMode, displayMode])


  // Global Mouse Move and Mouse Up Listeners for Dragging (TradingView style)
  useEffect(() => {
    if (!dragState || !dragState.isDragging) return

    const handleMouseMoveGlobal = (event: MouseEvent) => {
      const deltaY = event.clientY - dragState.startY
      
      if (dragState.isPriceScale) {
        // Dragging Price Scale (Y-axis): stretch/compress Y scale domain
        // Dragging down (positive deltaY) compresses visual scale (expands domain)
        // Dragging up (negative deltaY) stretches visual scale (shrinks domain)
        const factor = 1 + (deltaY / 220)
        const [minY, maxY] = dragState.initialYDomain
        const center = (minY + maxY) / 2
        const halfSpan = (maxY - minY) / 2
        const newHalfSpan = Math.max(spotPrice * 0.001, Math.min(spotPrice * 0.4, halfSpan * factor))
        setYDomain([center - newHalfSpan, center + newHalfSpan])
      } else {
        // Dragging Chart Body: Pan horizontally (scroll timeline) and vertically (shift center)
        const deltaX = event.clientX - dragState.startX
        
        // Pan Y (shifts domain up or down)
        const [minY, maxY] = dragState.initialYDomain
        const span = maxY - minY
        const strikeDelta = (deltaY / dimensions.height) * span * 0.95
        
        // Pan X (scrolls candles timeline)
        // Every 8 pixels of drag shifts 1 candle
        const candleShift = Math.round(deltaX / 8)
        const [startIdx, endIdx] = dragState.initialXRange
        const maxShift = startIdx
        const maxRightShift = candles.length - endIdx
        const actualShift = Math.max(-maxRightShift, Math.min(maxShift, candleShift))
        
        setYDomain([minY + strikeDelta, maxY + strikeDelta])
        setXRange([startIdx - actualShift, endIdx - actualShift])
      }
    }

    const handleMouseUpGlobal = () => {
      setDragState(null)
    }

    window.addEventListener('mousemove', handleMouseMoveGlobal)
    window.addEventListener('mouseup', handleMouseUpGlobal)
    return () => {
      window.removeEventListener('mousemove', handleMouseMoveGlobal)
      window.removeEventListener('mouseup', handleMouseUpGlobal)
    }
  }, [dragState, spotPrice, dimensions.height, candles.length])

  // Native non-passive wheel event listener to prevent main page scrolling while zooming
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheelNative = (event: WheelEvent) => {
      event.preventDefault() // Prevents parent/page from scrolling
      
      const zoomFactor = event.deltaY < 0 ? -3 : 3
      setXRange(prevRange => {
        const [startIdx, endIdx] = prevRange
        const currentSpan = endIdx - startIdx
        const newSpan = Math.max(10, Math.min(candles.length, currentSpan + zoomFactor))
        const newStart = Math.max(0, endIdx - newSpan)
        return [newStart, endIdx]
      })
    }

    el.addEventListener('wheel', handleWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', handleWheelNative)
  }, [candles.length])

  // Mouse down on chart wrapper
  const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    
    // If candles are collapsed, the entire 50px area is the price scale Y-axis.
    // Otherwise, Y-axis lies on the right edge of the candlestick SVG (width - 45 to width)
    const isPriceScale = isCandlesCollapsed || clickX >= (rect.width - 45)
    
    setDragState({
      isDragging: true,
      isPriceScale,
      startX: event.clientX,
      startY: event.clientY,
      initialYDomain: [...yDomain] as [number, number],
      initialXRange: [...xRange] as [number, number],
    })
  }

  // Double click resets zoom
  const handleDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const isPriceScale = isCandlesCollapsed || clickX >= (rect.width - 45)
    
    if (isPriceScale) {
      const pct = expiryMode === '0dte' ? 0.025 : 0.08
      const zoomRange = spotPrice * pct
      setYDomain([spotPrice - zoomRange, spotPrice + zoomRange])
      setXRange([Math.max(0, candles.length - 40), candles.length])
    }
  }

  // Mouse down on profile charts (always acts as a vertical pan/drag)
  const handleProfileMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    setDragState({
      isDragging: true,
      isPriceScale: false,
      startX: event.clientX,
      startY: event.clientY,
      initialYDomain: [...yDomain] as [number, number],
      initialXRange: [...xRange] as [number, number],
    })
  }

  // Double click resets zoom from profile charts
  const handleProfileDoubleClick = () => {
    const pct = expiryMode === '0dte' ? 0.025 : 0.08
    const zoomRange = spotPrice * pct
    setYDomain([spotPrice - zoomRange, spotPrice + zoomRange])
    setXRange([Math.max(0, candles.length - 40), candles.length])
  }

  // ─── D3 Rendering ───
  useEffect(() => {
    if (!candleSvgRef.current || !gexSvgRef.current || !volSvgRef.current || yDomain[0] === 0) return

    const isCollapsed = isCandlesCollapsed
    const margin = isCollapsed
      ? { top: 20, right: 45, bottom: 40, left: 10 }
      : { top: 20, right: 45, bottom: 40, left: 15 }
    const chartHeight = dimensions.height - margin.top - margin.bottom

    const totalWidth = dimensions.width
    const candleWidth = isCollapsed ? 75 : totalWidth * 0.5
    const profileWidth = isCollapsed ? (totalWidth - 75) / 2 : totalWidth * 0.25

    const candleSvg = d3.select(candleSvgRef.current)
    const gexSvg = d3.select(gexSvgRef.current)
    const volSvg = d3.select(volSvgRef.current)


    // Clear previous elements
    candleSvg.selectAll('*').remove()
    gexSvg.selectAll('*').remove()
    volSvg.selectAll('*').remove()

    // Dimensions
    candleSvg.attr('width', candleWidth).attr('height', dimensions.height)
    gexSvg.attr('width', profileWidth).attr('height', dimensions.height)
    volSvg.attr('width', profileWidth).attr('height', dimensions.height)

    // Shared Y scale (Strike Price)
    const yScale = d3.scaleLinear()
      .domain(yDomain)
      .range([chartHeight, 0])

    const formatCurrency = (val: number) => {
      const symbol = market === 'INDIA' ? '₹' : '$'
      return `${symbol}${val.toFixed(0)}`
    }

    const hideCrosshairs = () => {
      if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
    }

    // ─── 1. CANDLESTICK CHART ───
    {
      const g = candleSvg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
      const width = candleWidth - margin.left - margin.right

      const yTicks = yScale.ticks(8)

      if (!isCollapsed) {
        // Render Ticker and Spot watermark background
        const watermark = g.append('g')
          .attr('class', 'watermark')
          .style('opacity', 0.07)
          .style('pointer-events', 'none')

        watermark.append('text')
          .attr('x', 15)
          .attr('y', 50)
          .attr('fill', '#F5F5F7')
          .attr('font-size', '40px')
          .attr('font-weight', '900')
          .attr('font-family', typography.fontMono)
          .text(ticker)

        const symbol = market === 'INDIA' ? '₹' : '$'
        watermark.append('text')
          .attr('x', 15)
          .attr('y', 85)
          .attr('fill', '#F5F5F7')
          .attr('font-size', '24px')
          .attr('font-weight', '700')
          .attr('font-family', typography.fontMono)
          .text(`${symbol}${spotPrice.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`)

        const xScale = d3.scaleBand()
          .domain(visibleCandlesData.map((_, i) => i.toString()))
          .range([0, width])
          .padding(0.25)

        // Grid Y Lines
        g.selectAll('.grid-y')
          .data(yTicks)
          .enter().append('line')
          .attr('class', 'grid-y')
          .attr('x1', 0).attr('x2', width)
          .attr('y1', d => yScale(d))
          .attr('y2', d => yScale(d))
          .attr('stroke', '#131316').attr('stroke-width', 0.8)

        // Draw Candlesticks with fully solid color filled bodies
        visibleCandlesData.forEach((c, i) => {
          const x = xScale(i.toString())!
          const w = xScale.bandwidth()
          const isUp = c.close >= c.open
          const color = isUp ? '#00C805' : '#FF3B60'

          // Wick
          g.append('line')
            .attr('x1', x + w / 2).attr('x2', x + w / 2)
            .attr('y1', yScale(c.high)).attr('y2', yScale(c.low))
            .attr('stroke', color).attr('stroke-width', 1)

          // Body (solid green/red fill)
          g.append('rect')
            .attr('x', x).attr('y', yScale(Math.max(c.open, c.close)))
            .attr('width', w).attr('height', Math.max(1, Math.abs(yScale(c.open) - yScale(c.close))))
            .attr('fill', color)
            .attr('stroke', color).attr('stroke-width', 1)
        })

        // Indicator Lines (EMA 50 only)
        const lineGen = (data: number[]) => {
          return d3.line<any>()
            .x((_, idx) => xScale(idx.toString())! + xScale.bandwidth() / 2)
            .y(d => yScale(d))(data)
        }

        if (indicatorData.ema50.length > 0) {
          g.append('path')
            .attr('d', lineGen(indicatorData.ema50)!)
            .attr('fill', 'none').attr('stroke', '#FF3B60').attr('stroke-width', 1.2).style('opacity', 0.85)
        }
      }

      // Y Axis on the RIGHT side of the Candlestick chart (Always rendered to show Strikes)
      const yAxis = d3.axisRight(yScale).tickValues(yTicks).tickFormat(d => formatCurrency(d as number))
      const yAxisG = g.append('g').attr('transform', `translate(${width}, 0)`).call(yAxis)
      yAxisG.selectAll('line').attr('stroke', '#222')
      yAxisG.selectAll('path').attr('stroke', 'none')
      yAxisG.selectAll('text').attr('fill', '#B5B5B5').style('font-family', typography.fontMono).style('font-size', '9px').attr('dx', '3px')

      // X Axis (Time) with dynamic step sizing and TradingView style day transitions
      if (!isCollapsed) {
        const xScale = d3.scaleBand()
          .domain(visibleCandlesData.map((_, i) => i.toString()))
          .range([0, width])
          .padding(0.25)
        
        const xTicks: string[] = [];
        let lastDayStr = '';
        const indices = d3.range(0, visibleCandlesData.length);

        // First pass: identify day/month boundaries
        const boundaries: number[] = [];
        indices.forEach(i => {
          const c = visibleCandlesData[i];
          if (!c || !c.timestamp) return;
          const date = new Date(c.timestamp);
          const dayStr = timeframe.endsWith('m') 
            ? date.toLocaleDateString("en-US", { timeZone: "America/New_York" })
            : `${date.getFullYear()}-${date.getMonth()}`;

          if (i === 0 || dayStr !== lastDayStr) {
            boundaries.push(i);
            lastDayStr = dayStr;
          }
        });

        const maxLabels = Math.max(2, Math.floor(width / 65));
        const step = Math.ceil(visibleCandlesData.length / maxLabels);

        let lastAddedTickIdx = -999;
        indices.forEach(i => {
          const isBoundary = boundaries.includes(i);
          if (isBoundary) {
            xTicks.push(i.toString());
            lastAddedTickIdx = i;
          } else {
            const nextBoundary = boundaries.find(b => b > i);
            const distToNextBoundary = nextBoundary !== undefined ? nextBoundary - i : 999;

            if (i - lastAddedTickIdx >= step && distToNextBoundary >= Math.ceil(step / 2)) {
              xTicks.push(i.toString());
              lastAddedTickIdx = i;
            }
          }
        });

        const tickFormatter = (idxStr: string) => {
          const idx = parseInt(idxStr, 10);
          const c = visibleCandlesData[idx];
          if (!c) return '';
          if (!c.timestamp) return c.date || '';

          const date = new Date(c.timestamp);
          if (timeframe.endsWith('m')) {
            const isBoundary = boundaries.includes(idx);
            if (isBoundary) {
              return date.getDate().toString();
            }
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
          } else {
            const prev = idx > 0 ? visibleCandlesData[idx - 1] : null;
            let isNewMonth = false;
            if (prev && prev.timestamp) {
              const m1 = new Date(c.timestamp).getMonth();
              const m2 = new Date(prev.timestamp).getMonth();
              isNewMonth = m1 !== m2;
            } else {
              isNewMonth = true;
            }
            if (isNewMonth) {
              return date.toLocaleDateString("en-US", { month: 'short', timeZone: "America/New_York" });
            }
            return date.getDate().toString();
          }
        };

        const xAxis = d3.axisBottom(xScale).tickValues(xTicks).tickFormat(tickFormatter);
        const xAxisG = g.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis);
        xAxisG.selectAll('line').attr('stroke', 'none');
        xAxisG.selectAll('path').attr('stroke', '#1A1A1A');
        
        xAxisG.selectAll('text')
          .attr('fill', function() {
            const txt = d3.select(this).text();
            return txt.includes(':') ? '#5E5E62' : '#E5E5EA';
          })
          .style('font-weight', function() {
            const txt = d3.select(this).text();
            return txt.includes(':') ? 'normal' : 'bold';
          })
          .style('font-family', typography.fontSans)
          .style('font-size', '9px')
          .attr('dy', '10px');
      }
    }

    // ─── 2. LEFT PROFILE CHART (GEX/VEX) ───
    {
      const g = gexSvg.append('g').attr('transform', `translate(${margin.right},${margin.top})`)
      const width = profileWidth - margin.right - margin.left

      const activeProfile = displayMode === 'gamma-vol' ? gexProfile : vannaProfile
      const filteredProfile = activeProfile.filter(p => p.strike >= yDomain[0] && p.strike <= yDomain[1])
      
      const getVal = (p: any) => displayMode === 'gamma-vol' ? p.gex : p.vanna
      const maxVal = (d3.max(filteredProfile.map(p => Math.abs(getVal(p)))) || 1) * 1.1

      const xScale = d3.scaleLinear()
        .domain([-maxVal, maxVal])
        .range([0, width])

      // Zero-exposure center line
      g.append('line')
        .attr('x1', xScale(0)).attr('x2', xScale(0))
        .attr('y1', 0).attr('y2', chartHeight)
        .attr('stroke', '#222').attr('stroke-width', 1)

      // Draw solid filled horizontal bars
      filteredProfile.forEach(p => {
        const y = yScale(p.strike)
        if (y === undefined || y < 0 || y > chartHeight) return

        const val = getVal(p)
        const barWidth = Math.abs(xScale(val) - xScale(0))
        const x = val >= 0 ? xScale(0) : xScale(val)

        g.append('rect')
          .attr('x', x).attr('y', y - 2)
          .attr('width', Math.max(1.5, barWidth))
          .attr('height', 5)
          .attr('fill', val >= 0 ? 'rgba(0, 200, 5, 0.75)' : 'rgba(255, 59, 96, 0.75)')
          .attr('stroke', val >= 0 ? '#00C805' : '#FF3B60')
          .attr('stroke-width', 0.6)
          .attr('rx', 1)
      })

      // Spot Line
      const spotY = yScale(spotPrice)
      if (spotY >= 0 && spotY <= chartHeight) {
        g.append('line')
          .attr('x1', 0).attr('x2', width)
          .attr('y1', spotY).attr('y2', spotY)
          .attr('stroke', colors.accent.amber).attr('stroke-width', 1).style('opacity', 0.8)
      }

      // Gamma Flip / Zero Cross Line (Only relevant in Gamma Mode)
      if (displayMode === 'gamma-vol' && zeroGamma) {
        const flipY = yScale(zeroGamma)
        if (flipY >= 0 && flipY <= chartHeight) {
          g.append('line')
            .attr('x1', 0).attr('x2', width)
            .attr('y1', flipY).attr('y2', flipY)
            .attr('stroke', colors.accent.magenta).attr('stroke-width', 1).attr('stroke-dasharray', '3,3').style('opacity', 0.8)
        }
      }

      // X Axis
      const xAxis = d3.axisBottom(xScale).ticks(3).tickFormat(d => formatBillions(d as number))
      const xAxisG = g.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis)
      xAxisG.selectAll('line').attr('stroke', 'none')
      xAxisG.selectAll('path').attr('stroke', '#1A1A1A')
      xAxisG.selectAll('text').attr('fill', '#949494').style('font-family', typography.fontSans).style('font-size', '9px').attr('dy', '10px')

      // Label
      g.append('text')
        .attr('x', width / 2).attr('y', chartHeight + 32)
        .attr('text-anchor', 'middle')
        .attr('fill', '#949494').style('font-family', typography.fontSans).style('font-size', '9px')
        .text(displayMode === 'gamma-vol' ? 'GEX Profile' : 'Vanna Profile (VEX)')

      // Hover overlay (tooltips only)
      g.append('rect')
        .attr('width', width).attr('height', chartHeight)
        .attr('fill', 'transparent')
        .on('mousemove', (event) => {
          const [, my] = d3.pointer(event)
          const price = yScale.invert(my)

          const closest = filteredProfile.reduce((prev, curr) => {
            return Math.abs(curr.strike - price) < Math.abs(prev.strike - price) ? curr : prev
          }, filteredProfile[0])

          if (closest && tooltipRef.current && containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect()
            const val = getVal(closest)
            const labelText = displayMode === 'gamma-vol' ? 'Net GEX' : 'Net Vanna'
            tooltipRef.current.innerHTML = `
              <div style="font-family:${typography.fontSans};font-size:12px;color:${colors.text.primary};font-weight:600">Strike ${closest.strike.toFixed(0)}</div>
              <div style="font-family:${typography.fontMono};font-size:11px;color:${val >= 0 ? '#00C805' : '#FF3B60'};margin-top:2.5px">
                ${labelText}: ${formatBillions(val)}
              </div>
            `
            tooltipRef.current.style.opacity = '1'
            tooltipRef.current.style.left = `${event.clientX - containerRect.left + 14}px`
            tooltipRef.current.style.top = `${event.clientY - containerRect.top - 50}px`
          }
        })
        .on('mouseleave', hideCrosshairs)
    }

    // ─── 3. RIGHT PROFILE CHART (Volume/Charm) ───
    {
      const g = volSvg.append('g').attr('transform', `translate(${margin.right},${margin.top})`)
      const width = profileWidth - margin.right - margin.left

      const activeProfileRight = displayMode === 'gamma-vol' ? volProfile : charmProfile
      const filteredProfileRight = activeProfileRight.filter(p => p.strike >= yDomain[0] && p.strike <= yDomain[1])
      
      const getRightVal = (p: any) => displayMode === 'gamma-vol' ? p.volume : p.charm
      const isSymmetric = displayMode === 'vanna-charm'
      
      const maxVal = (d3.max(filteredProfileRight.map(p => Math.abs(getRightVal(p)))) || 1) * 1.1

      const xScale = d3.scaleLinear()
        .domain(isSymmetric ? [-maxVal, maxVal] : [0, maxVal])
        .range([0, width])

      if (isSymmetric) {
        // Zero line in the center for Charm
        g.append('line')
          .attr('x1', xScale(0)).attr('x2', xScale(0))
          .attr('y1', 0).attr('y2', chartHeight)
          .attr('stroke', '#222').attr('stroke-width', 1)
      }

      // Draw solid filled bars
      filteredProfileRight.forEach(p => {
        const y = yScale(p.strike)
        if (y === undefined || y < 0 || y > chartHeight) return

        const val = getRightVal(p)
        const barWidth = isSymmetric ? Math.abs(xScale(val) - xScale(0)) : xScale(val)
        const x = isSymmetric ? (val >= 0 ? xScale(0) : xScale(val)) : 0

        g.append('rect')
          .attr('x', x).attr('y', y - 2)
          .attr('width', Math.max(1.5, barWidth))
          .attr('height', 5)
          .attr('fill', isSymmetric 
            ? (val >= 0 ? 'rgba(0, 200, 5, 0.75)' : 'rgba(255, 59, 96, 0.75)') 
            : 'rgba(0, 200, 255, 0.55)')
          .attr('stroke', isSymmetric 
            ? (val >= 0 ? '#00C805' : '#FF3B60') 
            : '#00C8FF')
          .attr('stroke-width', 0.6)
          .attr('rx', 1)
      })

      // Spot Line
      const spotY = yScale(spotPrice)
      if (spotY >= 0 && spotY <= chartHeight) {
        g.append('line')
          .attr('x1', 0).attr('x2', width)
          .attr('y1', spotY).attr('y2', spotY)
          .attr('stroke', colors.accent.amber).attr('stroke-width', 1).style('opacity', 0.8)
      }

      // X Axis
      const xAxis = d3.axisBottom(xScale).ticks(3).tickFormat(d => isSymmetric ? formatBillions(d as number) : formatCompact(d as number))
      const xAxisG = g.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis)
      xAxisG.selectAll('line').attr('stroke', 'none')
      xAxisG.selectAll('path').attr('stroke', '#1A1A1A')
      xAxisG.selectAll('text').attr('fill', '#949494').style('font-family', typography.fontSans).style('font-size', '9px').attr('dy', '10px')

      // Label
      g.append('text')
        .attr('x', width / 2).attr('y', chartHeight + 32)
        .attr('text-anchor', 'middle')
        .attr('fill', '#949494').style('font-family', typography.fontSans).style('font-size', '9px')
        .text(displayMode === 'gamma-vol' ? 'Volume Profile' : 'Charm Profile (CEX)')

      // Hover overlay
      g.append('rect')
        .attr('width', width).attr('height', chartHeight)
        .attr('fill', 'transparent')
        .on('mousemove', (event) => {
          const [, my] = d3.pointer(event)
          const price = yScale.invert(my)

          const closest = filteredProfileRight.reduce((prev, curr) => {
            return Math.abs(curr.strike - price) < Math.abs(prev.strike - price) ? curr : prev
          }, filteredProfileRight[0])

          if (closest && tooltipRef.current && containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect()
            const val = getRightVal(closest)
            
            const isVolMode = displayMode === 'gamma-vol'
            const formattedVal = isVolMode ? val.toLocaleString() + ' contracts' : formatBillions(val)
            const labelText = isVolMode ? 'Volume' : 'Net Charm'
            const textClr = isVolMode 
              ? colors.accent.cyan 
              : (val >= 0 ? '#00C805' : '#FF3B60')

            tooltipRef.current.innerHTML = `
              <div style="font-family:${typography.fontSans};font-size:12px;color:${colors.text.primary};font-weight:600">Strike ${closest.strike.toFixed(0)}</div>
              <div style="font-family:${typography.fontMono};font-size:11px;color:${textClr};margin-top:2.5px">
                ${labelText}: ${formattedVal}
              </div>
            `
            tooltipRef.current.style.opacity = '1'
            tooltipRef.current.style.left = `${event.clientX - containerRect.left + 14}px`
            tooltipRef.current.style.top = `${event.clientY - containerRect.top - 50}px`
          }
        })
        .on('mouseleave', hideCrosshairs)
    }

  }, [dimensions, yDomain, visibleCandlesData, indicatorData, gexProfile, volProfile, vannaProfile, charmProfile, spotPrice, zeroGamma, market, ticker, displayMode, isCandlesCollapsed])

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-row bg-black relative select-none overflow-hidden"
    >
      {/* Timeframe Selector and Collapsible Toggle Overlay */}
      <div className="absolute top-3 left-4 z-20 flex items-center gap-1 bg-black/70 backdrop-blur-md px-1.5 py-1 rounded border border-[#222]">
        {!isCandlesCollapsed && ['1m', '5m', '15m', '1D', '1W'].map(tf => {
          const active = timeframe === tf
          return (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all font-bold ${
                active 
                  ? 'bg-terminal-green/15 text-terminal-green border border-terminal-green/30' 
                  : 'bg-transparent text-[#777] border border-transparent hover:text-white'
              }`}
            >
              {tf}
            </button>
          )
        })}
        {loadingHistory && (
          <div className="w-2.5 h-2.5 border border-transparent border-t-terminal-green rounded-full animate-spin ml-1" />
        )}

        {/* Column divider line */}
        {!isCandlesCollapsed && <div className="w-[1px] h-3.5 bg-[#222] mx-1" />}

        {/* Collapsible Candlestick Toggle Button */}
        <button
          onClick={() => setIsCandlesCollapsed(!isCandlesCollapsed)}
          className="p-0.5 rounded hover:bg-[#111] text-[#777] hover:text-white transition-colors flex items-center justify-center"
          title={isCandlesCollapsed ? "Expand Candlestick Chart" : "Collapse Candlestick Chart"}
          type="button"
        >
          {isCandlesCollapsed ? (
            <ChevronsRight className="w-3.5 h-3.5 text-terminal-green" />
          ) : (
            <ChevronsLeft className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Greek Mode Selection & Dynamic Rates Badge Overlay */}
      <div className="absolute top-3 right-4 z-20 flex items-center gap-2">
        {/* Sourced vs Assumed Rates Indicator */}
        <div 
          className="px-2 py-1 rounded text-[9px] font-mono border bg-black/75 backdrop-blur-md text-[#888] border-[#222] flex items-center gap-1.5"
          title={`US Risk-Free Rate: ${(ratesInfo.usRiskFreeRate * 100).toFixed(2)}% | India Repo Benchmark: ${(ratesInfo.indiaRiskFreeRate * 100).toFixed(2)}%\nSource: ${ratesInfo.source}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${ratesInfo.source.startsWith('Assumed') ? 'bg-amber-500' : 'bg-green-500 animate-pulse'}`} />
          <span className="text-white font-semibold text-[8px] tracking-wider">
            {ratesInfo.source.startsWith('Assumed') ? 'ASSUMED' : 'SOURCED'}
          </span>
          <span>r: {(activeR * 100).toFixed(2)}%</span>
        </div>

        {/* Mode Toggle pills */}
        <div className="flex items-center gap-1 bg-black/70 backdrop-blur-md px-1 py-1 rounded border border-[#222]">
          <button
            onClick={() => setDisplayMode('gamma-vol')}
            className={`px-2.5 py-0.5 rounded text-[10px] font-mono transition-all font-bold ${
              displayMode === 'gamma-vol'
                ? 'bg-terminal-green/15 text-terminal-green border border-terminal-green/30'
                : 'bg-transparent text-[#777] border border-transparent hover:text-white'
            }`}
            type="button"
          >
            GAMMA / VOL
          </button>
          <button
            onClick={() => setDisplayMode('vanna-charm')}
            className={`px-2.5 py-0.5 rounded text-[10px] font-mono transition-all font-bold ${
              displayMode === 'vanna-charm'
                ? 'bg-terminal-green/15 text-terminal-green border border-terminal-green/30'
                : 'bg-transparent text-[#777] border border-transparent hover:text-white'
            }`}
            type="button"
          >
            VANNA / CHARM
          </button>
        </div>
      </div>

      {/* Candlestick SVG with Wheel zoom, drag events and reset double click */}
      <svg 
        ref={candleSvgRef} 
        className={`h-full ${isCandlesCollapsed ? 'cursor-ns-resize' : 'cursor-crosshair'}`} 
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      />

      {/* GEX/VEX Profile SVG */}
      <svg 
        ref={gexSvgRef} 
        className="h-full cursor-grab active:cursor-grabbing" 
        onMouseDown={handleProfileMouseDown}
        onDoubleClick={handleProfileDoubleClick}
      />

      {/* Volume/CEX Profile SVG */}
      <svg 
        ref={volSvgRef} 
        className="h-full cursor-grab active:cursor-grabbing" 
        onMouseDown={handleProfileMouseDown}
        onDoubleClick={handleProfileDoubleClick}
      />

      {/* Sync Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none opacity-0 bg-[#0F0F12] border border-[#222]/80 px-3 py-2 rounded text-[#D4D4D8] z-30 shadow-2xl transition-opacity duration-100"
        style={{ width: "max-content" }}
      />
    </div>
  )
}
