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
  computeCallPutWalls,
  type PricingMethod
} from "@/lib/calculations"
import { ChevronsLeft, ChevronsRight, BarChart3, Settings2, RotateCw, Layers, Calendar } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover"
import { ExpirySelector } from "../controls/expiry-selector"

function formatCompact(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(0)}k`
  return num.toString()
}

function formatMillions(num: number): string {
  const val = Math.abs(num)
  const sign = num >= 0 ? '+' : '−'
  return `${sign}${(val / 1000000).toFixed(0)}M`
}

// Kept for tooltips (works on values scaled to Billions, e.g. 0.85 = 850M)
function formatBillions(num: number): string {
  if (num === 0) return '0'
  const val = Math.abs(num)
  const millionsVal = val * 1000
  if (millionsVal >= 1) {
    return `${num >= 0 ? '+' : '−'}${millionsVal.toFixed(0)}M`
  }
  if (millionsVal >= 0.001) {
    return `${num >= 0 ? '+' : '−'}${millionsVal.toFixed(2)}M`
  }
  return `${num >= 0 ? '+' : '−'}${(val * 1e9).toFixed(0)}`
}

// Axis formatter: domain values are in billions (0–2), output shows “+200M” or "+50k" style
function formatAxisM(domainVal: number): string {
  if (domainVal === 0) return '0'
  const sign = domainVal > 0 ? '+' : '−'
  const absVal = Math.abs(domainVal)
  
  if (absVal >= 0.001) {
    const millions = absVal * 1000
    const formatted = millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)
    return `${sign}${formatted}M`
  } else {
    const thousands = absVal * 1000000
    const formatted = thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)
    return `${sign}${formatted}k`
  }
}

interface SyncedStrikeWorkspaceProps {
  startOptionData: OptionData[]
  endOptionData: OptionData[]
  ticker: string
  startSpotPrice: number
  endSpotPrice: number
  market: 'USA' | 'INDIA'
  pricingMethod: PricingMethod
  expiryMode: string
  isLive: boolean
  defaultRotated?: boolean
  defaultCandlesCollapsed?: boolean
  availableExpiries?: string[]
  selectedExpiries?: string[]
  onSelectedExpiriesChange?: (expiries: string[]) => void
  onExpiryModeChange?: (mode: any) => void
}


export function SyncedStrikeWorkspace({
  startOptionData,
  endOptionData,
  ticker,
  startSpotPrice,
  endSpotPrice,
  market,
  pricingMethod,
  expiryMode,
  isLive,
  defaultRotated,
  defaultCandlesCollapsed,
  availableExpiries,
  selectedExpiries,
  onSelectedExpiriesChange,
  onExpiryModeChange,
}: SyncedStrikeWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const candleSvgRef = useRef<SVGSVGElement>(null)
  const gexSvgRef = useRef<SVGSVGElement>(null)
  const volSvgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [dimensions, setDimensions] = useState({ width: 1000, height: 500 })
  const [yDomain, setYDomain] = useState<[number, number]>([0, 0])
  const [xRange, setXRange] = useState<[number, number]>([0, 80])

  // Timeframe state: defaults to 1D (Daily), switches to 5m for 0DTE
  const [timeframe, setTimeframe] = useState<string>('1D')
  const [showAbsolute, setShowAbsolute] = useState(false)
  const [candlesData, setCandlesData] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Advanced Greek display toggle state
  const [displayMode, setDisplayMode] = useState<'gamma-vol' | 'vanna-charm'>('gamma-vol')

  // Collapsible Candlestick panel state
  const [isCandlesCollapsed, setIsCandlesCollapsed] = useState(defaultCandlesCollapsed ?? false)
  const [isGexOverlayEnabled, setIsGexOverlayEnabled] = useState(false)

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

  // Synchronize GEX overlay state with native browser fullscreen state
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!containerRef.current) return
      const isCurrentlyFullscreen = document.fullscreenElement === containerRef.current
      setIsGexOverlayEnabled(isCurrentlyFullscreen)
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange)
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange)
    document.addEventListener("mozfullscreenchange", handleFullscreenChange)
    document.addEventListener("MSFullscreenChange", handleFullscreenChange)

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange)
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange)
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange)
    }
  }, [])

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    
    const nextState = !isGexOverlayEnabled
    
    try {
      if (nextState) {
        const el = containerRef.current
        if (el.requestFullscreen) {
          el.requestFullscreen()
        } else if ((el as any).webkitRequestFullscreen) {
          (el as any).webkitRequestFullscreen()
        } else if ((el as any).mozRequestFullScreen) {
          (el as any).mozRequestFullScreen()
        } else if ((el as any).msRequestFullscreen) {
          (el as any).msRequestFullscreen()
        }
      } else {
        if (document.fullscreenElement) {
          if (document.exitFullscreen) {
            document.exitFullscreen()
          } else if ((document as any).webkitExitFullscreen) {
            (document as any).webkitExitFullscreen()
          } else if ((document as any).mozCancelFullScreen) {
            (document as any).mozCancelFullScreen()
          } else if ((document as any).msExitFullscreen) {
            (document as any).msExitFullscreen()
          }
        }
      }
    } catch (err) {
      console.warn("Fullscreen toggle failed:", err)
      setIsGexOverlayEnabled(nextState)
    }
  }


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
          setXRange([0, len])
        }
      })
      .catch(err => {
        console.warn('Unable to load real history. Falling back to mock generator.', err)
        // Clear candlesData so we fall back to mock walk
        setCandlesData([])
        setXRange([0, 80])
      })
      .finally(() => {
        if (active) setLoadingHistory(false)
      })

    return () => { active = false }
  }, [ticker, timeframe])

  const [isRotated, setIsRotated] = useState(defaultRotated ?? false)

  const [dragState, setDragState] = useState<{
    isDragging: boolean
    isPriceScale: boolean
    isProfileDrag?: boolean
    isTimeScale?: boolean
    startX: number
    startY: number
    initialYDomain: [number, number]
    initialXRange: [number, number]
  } | null>(null)

  // Calculate Walls & GEX Clusters
  const walls = useMemo(() => {
    if (!endOptionData.length || !endSpotPrice) return { callWall: 0, putWall: 0 }
    
    // Find the nearest expiration date
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const expiries = Array.from(new Set(endOptionData.map(o => o.expiration.getTime())))
      .map(t => new Date(t))
      .sort((a, b) => a.getTime() - b.getTime())
    const selectedExpiry = expiries.find(d => d >= now) || expiries[0] || new Date()
    
    return computeCallPutWalls(endOptionData, selectedExpiry)
  }, [endOptionData, endSpotPrice])

  // Calculate Probability of Touching (PoT) for Call Wall and Put Wall
  const wallTouchProbabilities = useMemo(() => {
    if (!endOptionData.length || !walls.callWall || !walls.putWall) {
      return { callWallTouch: 0, putWallTouch: 0 }
    }

    const expiries = Array.from(new Set(endOptionData.map(o => o.expiration.getTime())))
      .map(t => new Date(t))
      .sort((a, b) => a.getTime() - b.getTime())
    
    if (expiries.length === 0) return { callWallTouch: 0, putWallTouch: 0 }
    const furthestExpiry = expiries[expiries.length - 1]

    // Find Call Wall option for furthest expiry
    const callWallStrike = walls.callWall
    const callWallOpts = endOptionData.filter(o => 
      o.expiration.toDateString() === furthestExpiry.toDateString() && 
      o.type === 'C'
    )
    let callWallOpt = callWallOpts.find(o => o.strike === callWallStrike)
    if (!callWallOpt && callWallOpts.length > 0) {
      callWallOpt = callWallOpts.reduce((prev, curr) => 
        Math.abs(curr.strike - callWallStrike) < Math.abs(prev.strike - callWallStrike) ? curr : prev
      )
    }

    // Find Put Wall option for furthest expiry
    const putWallStrike = walls.putWall
    const putWallOpts = endOptionData.filter(o => 
      o.expiration.toDateString() === furthestExpiry.toDateString() && 
      o.type === 'P'
    )
    let putWallOpt = putWallOpts.find(o => o.strike === putWallStrike)
    if (!putWallOpt && putWallOpts.length > 0) {
      putWallOpt = putWallOpts.reduce((prev, curr) => 
        Math.abs(curr.strike - putWallStrike) < Math.abs(prev.strike - putWallStrike) ? curr : prev
      )
    }

    const callDelta = callWallOpt ? Math.abs(callWallOpt.delta || 0.15) : 0.15
    const putDelta = putWallOpt ? Math.abs(putWallOpt.delta || -0.15) : 0.15

    const callWallTouch = Math.min(99, Math.max(1, Math.round(2 * callDelta * 100)))
    const putWallTouch = Math.min(99, Math.max(1, Math.round(2 * putDelta * 100)))

    return { callWallTouch, putWallTouch }
  }, [endOptionData, walls])

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

  // 1. Candlestick data from historical server collection (no mock data fallback)
  const candles = useMemo(() => {
    return candlesData
  }, [candlesData])

  // Slice visible candles and indicator data
  const visibleCandlesData = useMemo(() => {
    return candles.slice(xRange[0], xRange[1])
  }, [candles, xRange])

  // 2. Calculate dynamic Indicators (EMA 50 only)
  const indicatorData = useMemo(() => {
    const closes = candles.map(c => c.close)
    if (closes.length === 0) {
      return { ema50: [] }
    }

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

  const enrichedStartOptionData = useMemo(() => {
    const cloned = startOptionData.map(o => ({ ...o }))
    computeGEXByStrike(startSpotPrice, cloned, pricingMethod)
    computeVannaByStrike(startSpotPrice, cloned, activeR, activeQ, pricingMethod)
    computeCharmByStrike(startSpotPrice, cloned, activeR, activeQ, pricingMethod)
    return cloned
  }, [startOptionData, startSpotPrice, pricingMethod, activeR, activeQ])

  const enrichedEndOptionData = useMemo(() => {
    const cloned = endOptionData.map(o => ({ ...o }))
    computeGEXByStrike(endSpotPrice, cloned, pricingMethod)
    computeVannaByStrike(endSpotPrice, cloned, activeR, activeQ, pricingMethod)
    computeCharmByStrike(endSpotPrice, cloned, activeR, activeQ, pricingMethod)
    return cloned
  }, [endOptionData, endSpotPrice, pricingMethod, activeR, activeQ])

  const startGexProfile = useMemo(() => {
    const raw = computeGEXByStrike(startSpotPrice, enrichedStartOptionData, pricingMethod)
    return raw.sort((a, b) => a.strike - b.strike)
  }, [startSpotPrice, enrichedStartOptionData, pricingMethod])

  const endGexProfile = useMemo(() => {
    const raw = computeGEXByStrike(endSpotPrice, enrichedEndOptionData, pricingMethod)
    return raw.sort((a, b) => a.strike - b.strike)
  }, [endSpotPrice, enrichedEndOptionData, pricingMethod])

  const startVolProfile = useMemo(() => {
    const raw = computeVolumeByStrike(enrichedStartOptionData)
    return raw.sort((a, b) => a.strike - b.strike)
  }, [enrichedStartOptionData])

  const endVolProfile = useMemo(() => {
    const raw = computeVolumeByStrike(enrichedEndOptionData)
    return raw.sort((a, b) => a.strike - b.strike)
  }, [enrichedEndOptionData])

  const startVannaProfile = useMemo(() => {
    return computeVannaByStrike(startSpotPrice, enrichedStartOptionData, activeR, activeQ, pricingMethod)
  }, [startSpotPrice, enrichedStartOptionData, activeR, activeQ, pricingMethod])

  const endVannaProfile = useMemo(() => {
    return computeVannaByStrike(endSpotPrice, enrichedEndOptionData, activeR, activeQ, pricingMethod)
  }, [endSpotPrice, enrichedEndOptionData, activeR, activeQ, pricingMethod])

  const startCharmProfile = useMemo(() => {
    return computeCharmByStrike(startSpotPrice, enrichedStartOptionData, activeR, activeQ, pricingMethod)
  }, [startSpotPrice, enrichedStartOptionData, activeR, activeQ, pricingMethod])

  const endCharmProfile = useMemo(() => {
    return computeCharmByStrike(endSpotPrice, enrichedEndOptionData, activeR, activeQ, pricingMethod)
  }, [endSpotPrice, enrichedEndOptionData, activeR, activeQ, pricingMethod])

  const endZeroGamma = useMemo(() => findZeroGammaLevel(enrichedEndOptionData, endSpotPrice), [enrichedEndOptionData, endSpotPrice])

  // Profile data combining NET and ABS exposures
  const leftProfileDataCombined = useMemo(() => {
    const isGammaMode = displayMode === 'gamma-vol'
    const startProfile = isGammaMode ? startGexProfile : startVannaProfile
    const endProfile = isGammaMode ? endGexProfile : endVannaProfile

    const strikes = Array.from(new Set([
      ...startProfile.map(p => p.strike),
      ...endProfile.map(p => p.strike),
    ])).sort((a, b) => a - b)

    return strikes.map(strike => {
      const startOptions = enrichedStartOptionData.filter(o => o.strike === strike)
      const endOptions = enrichedEndOptionData.filter(o => o.strike === strike)

      let startCallVal = 0
      let startPutVal = 0
      let endCallVal = 0
      let endPutVal = 0

      startOptions.forEach(o => {
        const val = isGammaMode ? (o.GEX_BS || 0) : (o.VEX_BS || 0)
        if (o.type === 'C') startCallVal += Math.abs(val)
        else startPutVal += Math.abs(val)
      })

      endOptions.forEach(o => {
        const val = isGammaMode ? (o.GEX_BS || 0) : (o.VEX_BS || 0)
        if (o.type === 'C') endCallVal += Math.abs(val)
        else endPutVal += Math.abs(val)
      })

      const startItem = startProfile.find(p => p.strike === strike)
      const endItem = endProfile.find(p => p.strike === strike)

      const startNetVal = startItem ? (isGammaMode ? ((startItem as any).gex || 0) : ((startItem as any).vanna || 0)) : 0
      const endNetVal = endItem ? (isGammaMode ? ((endItem as any).gex || 0) : ((endItem as any).vanna || 0)) : 0

      return {
        strike,
        startNetVal,
        endNetVal,
        startCallVal: startCallVal / 1e9,
        startPutVal: -startPutVal / 1e9,
        endCallVal: endCallVal / 1e9,
        endPutVal: -endPutVal / 1e9,
      }
    })
  }, [
    displayMode,
    startGexProfile, endGexProfile,
    startVannaProfile, endVannaProfile,
    enrichedStartOptionData, enrichedEndOptionData
  ])

  const rightProfileDataCombined = useMemo(() => {
    const isVolMode = displayMode === 'gamma-vol'
    const startProfile = isVolMode ? startVolProfile : startCharmProfile
    const endProfile = isVolMode ? endVolProfile : endCharmProfile

    const strikes = Array.from(new Set([
      ...startProfile.map(p => p.strike),
      ...endProfile.map(p => p.strike),
    ])).sort((a, b) => a - b)

    return strikes.map(strike => {
      const startOptions = enrichedStartOptionData.filter(o => o.strike === strike)
      const endOptions = enrichedEndOptionData.filter(o => o.strike === strike)

      let startCallVal = 0
      let startPutVal = 0
      let endCallVal = 0
      let endPutVal = 0

      startOptions.forEach(o => {
        const val = isVolMode ? (o.volume || 0) : (o.CEX_BS || 0)
        if (o.type === 'C') startCallVal += Math.abs(val)
        else startPutVal += Math.abs(val)
      })

      endOptions.forEach(o => {
        const val = isVolMode ? (o.volume || 0) : (o.CEX_BS || 0)
        if (o.type === 'C') endCallVal += Math.abs(val)
        else endPutVal += Math.abs(val)
      })

      const startItem = startProfile.find(p => p.strike === strike)
      const endItem = endProfile.find(p => p.strike === strike)

      const startNetVal = startItem ? (isVolMode ? ((startItem as any).volume || 0) : ((startItem as any).charm || 0)) : 0
      const endNetVal = endItem ? (isVolMode ? ((endItem as any).volume || 0) : ((endItem as any).charm || 0)) : 0

      const divisor = isVolMode ? 1 : 1e9
      return {
        strike,
        startNetVal,
        endNetVal,
        startCallVal: startCallVal / divisor,
        startPutVal: -startPutVal / divisor,
        endCallVal: endCallVal / divisor,
        endPutVal: -endPutVal / divisor,
      }
    })
  }, [
    displayMode,
    startVolProfile, endVolProfile,
    startCharmProfile, endCharmProfile,
    enrichedStartOptionData, enrichedEndOptionData
  ])

  // ─── Ticker-aware stable scale ───────────────────────────────────────────
  // Compute the max GEX/Vanna across the FULL (unfiltered) profile so the axis
  // stays constant while panning/zooming, but adapts to each ticker's magnitude.
  const tickerGexMax = useMemo(() => {
    const vals = leftProfileDataCombined.flatMap(p => {
      if (showAbsolute) {
        return [
          Math.abs(p.startNetVal), Math.abs(p.endNetVal),
          Math.abs(p.startCallVal), Math.abs(p.endCallVal),
          Math.abs(p.startPutVal), Math.abs(p.endPutVal),
        ]
      } else {
        return [
          Math.abs(p.startNetVal), Math.abs(p.endNetVal),
        ]
      }
    })
    const peak = Math.max(...vals, 0.0001) // at least 100k headroom
    
    // Dynamically calculate clean scale limits depending on the order of magnitude
    const orderOfMagnitude = Math.pow(10, Math.floor(Math.log10(peak))) || 0.0001
    let step = orderOfMagnitude
    const ratio = peak / orderOfMagnitude
    
    if (ratio > 5) {
      step = orderOfMagnitude * 2
    } else if (ratio > 2) {
      step = orderOfMagnitude
    } else {
      step = orderOfMagnitude / 2
    }
    
    if (step <= 0) step = 0.0001
    return Math.ceil(peak / step) * step
  }, [leftProfileDataCombined, showAbsolute])

  // Right chart: ticker-aware max for Volume (contracts) AND Vanna/Charm (billion-scale)
  // Returns a single number representing the domain ceiling for the current display mode.
  const tickerRightMax = useMemo(() => {
    const isVolMode = displayMode === 'gamma-vol'
    if (isVolMode) {
      // Volume: raw contract counts
      const vals = rightProfileDataCombined.flatMap(p => {
        if (showAbsolute) {
          return [
            Math.abs(p.startNetVal), Math.abs(p.endNetVal),
            Math.abs(p.startCallVal), Math.abs(p.endCallVal),
            Math.abs(p.startPutVal), Math.abs(p.endPutVal),
          ]
        } else {
          return [
            Math.abs(p.startNetVal), Math.abs(p.endNetVal),
          ]
        }
      })
      const peak = Math.max(...vals, 1)
      const limit = peak
      // Round to a clean step: 1k, 5k, 10k, 50k, 100k, etc.
      const magnitudeStep = Math.pow(10, Math.floor(Math.log10(limit))) / 2 || 1
      return Math.ceil(limit / magnitudeStep) * magnitudeStep
    }
    // Charm/Vanna: same billion-scale as GEX
    const vals = rightProfileDataCombined.flatMap(p => {
      if (showAbsolute) {
        return [
          Math.abs(p.startNetVal), Math.abs(p.endNetVal),
          Math.abs(p.startCallVal), Math.abs(p.endCallVal),
          Math.abs(p.startPutVal), Math.abs(p.endPutVal),
        ]
      } else {
        return [
          Math.abs(p.startNetVal), Math.abs(p.endNetVal),
        ]
      }
    })
    const peak = Math.max(...vals, 0.0001)
    const limit = peak / 0.75
    
    const orderOfMagnitude = Math.pow(10, Math.floor(Math.log10(limit))) || 0.0001
    let step = orderOfMagnitude
    const ratio = limit / orderOfMagnitude
    
    if (ratio > 5) {
      step = orderOfMagnitude * 2
    } else if (ratio > 2) {
      step = orderOfMagnitude
    } else {
      step = orderOfMagnitude / 2
    }
    
    if (step <= 0) step = 0.0001
    return Math.ceil(limit / step) * step
  }, [rightProfileDataCombined, displayMode, showAbsolute])

  // Helper to reset to fully zoomed out state
  const resetToFullyZoomedOut = () => {
    const allStrikes = Array.from(new Set([
      ...startGexProfile.map(p => p.strike),
      ...endGexProfile.map(p => p.strike),
      ...startVolProfile.map(p => p.strike),
      ...endVolProfile.map(p => p.strike),
      ...startVannaProfile.map(p => p.strike),
      ...endVannaProfile.map(p => p.strike),
      ...startCharmProfile.map(p => p.strike),
      ...endCharmProfile.map(p => p.strike),
    ])).sort((a, b) => a - b)

    if (allStrikes.length > 0) {
      // Find strike spacing near spot
      let strikeSpacing = 5 // fallback
      const strikesNearSpot = allStrikes.filter(s => s >= endSpotPrice * 0.95 && s <= endSpotPrice * 1.05)
      if (strikesNearSpot.length > 1) {
        const diffs: number[] = []
        for (let i = 1; i < strikesNearSpot.length; i++) {
          const diff = strikesNearSpot[i] - strikesNearSpot[i - 1]
          if (diff > 0) diffs.push(diff)
        }
        if (diffs.length > 0) {
          diffs.sort((a, b) => a - b)
          strikeSpacing = diffs[Math.floor(diffs.length / 2)]
        }
      }

      // We want to limit the vertical range of strikes to prevent overlapping of bars
      const chartHeight = dimensions.height - 60 // average padding (margin top 20, margin bottom 40)
      const minSpacingPixels = 7.5 // bar height is 5px, we want at least 2.5px gap to prevent overlap
      const maxStrikes = Math.floor(chartHeight / minSpacingPixels)

      const W = (maxStrikes / 2) * strikeSpacing
      const minRange = endSpotPrice - W
      const maxRange = endSpotPrice + W

      const clampedMin = Math.max(allStrikes[0], minRange)
      const clampedMax = Math.min(allStrikes[allStrikes.length - 1], maxRange)

      setYDomain([Math.max(0, clampedMin - strikeSpacing * 0.5), clampedMax + strikeSpacing * 0.5])
    } else {
      const pct = expiryMode === '0dte' ? 0.025 : 0.08
      const zoomRange = endSpotPrice * pct
      setYDomain([endSpotPrice - zoomRange, endSpotPrice + zoomRange])
    }
    setXRange([0, candles.length])
  }

  // 4. Set initial domain based on all strikes (fully zoomed out)
  useEffect(() => {
    resetToFullyZoomedOut()
  }, [startGexProfile, endGexProfile, startVolProfile, endVolProfile, startVannaProfile, endVannaProfile, startCharmProfile, endCharmProfile, endSpotPrice, ticker, expiryMode, displayMode, candles.length, dimensions.height])


  // Global Mouse Move and Mouse Up Listeners for Dragging (TradingView style)
  useEffect(() => {
    if (!dragState || !dragState.isDragging) return

    const handleMouseMoveGlobal = (event: MouseEvent) => {
      const deltaY = event.clientY - dragState.startY
      const deltaX = event.clientX - dragState.startX

      if (dragState.isPriceScale) {
        // Dragging Price Scale (Y-axis): stretch/compress Y scale domain
        // Dragging down (positive deltaY) compresses visual scale (expands domain)
        // Dragging up (negative deltaY) stretches visual scale (shrinks domain)
        const factor = 1 + (deltaY / 220)
        const [minY, maxY] = dragState.initialYDomain
        const center = (minY + maxY) / 2
        const halfSpan = (maxY - minY) / 2
        const newHalfSpan = Math.max(endSpotPrice * 0.001, Math.min(endSpotPrice * 0.4, halfSpan * factor))
        setYDomain([center - newHalfSpan, center + newHalfSpan])
      } else if (dragState.isTimeScale) {
        // Dragging Time Scale (X-axis): stretch/compress X scale range (timeline zoom)
        const factor = 1 + (deltaX / 220)
        const [startIdx, endIdx] = dragState.initialXRange
        const initialSpan = endIdx - startIdx
        const newSpan = Math.max(5, Math.min(candles.length, Math.round(initialSpan * factor)))
        
        // Adjust bounds centered around the mid-index of the initial range
        const midIdx = (startIdx + endIdx) / 2
        const halfSpan = newSpan / 2
        let newStart = Math.round(midIdx - halfSpan)
        let newEnd = Math.round(midIdx + halfSpan)
        
        // Clamp bounds to [0, candles.length]
        if (newStart < 0) {
          newEnd -= newStart
          newStart = 0
        }
        if (newEnd > candles.length) {
          newStart -= (newEnd - candles.length)
          newEnd = candles.length
        }
        newStart = Math.max(0, newStart)
        
        setXRange([newStart, newEnd])
      } else {
        const [minY, maxY] = dragState.initialYDomain
        const span = maxY - minY

        if (isRotated && dragState.isProfileDrag) {
          // Rotated mode profile drag: horizontal panning shifts the shared strike price domain
          const strikeDelta = -(deltaX / dimensions.width) * span * 0.95
          setYDomain([minY + strikeDelta, maxY + strikeDelta])
        } else {
          // Dragging Chart Body: Pan horizontally (scroll timeline) and vertically (shift center)
          // Pan Y (shifts domain up or down)
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
  }, [dragState, endSpotPrice, dimensions.height, candles.length, isRotated, dimensions.width])



  // Mouse down on chart wrapper
  const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const clickY = event.clientY - rect.top

    // If candles are collapsed, the entire 50px area is the price scale Y-axis.
    // Otherwise, Y-axis lies on the right edge of the candlestick SVG (width - 45 to width)
    const isPriceScale = isCandlesCollapsed || clickX >= (rect.width - 45)
    const isTimeScale = clickY >= (rect.height - 40)

    setDragState({
      isDragging: true,
      isPriceScale: isTimeScale ? false : isPriceScale,
      isProfileDrag: false,
      isTimeScale,
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
      resetToFullyZoomedOut()
    }
  }

  // Double click resets zoom from profile charts
  const handleProfileDoubleClick = () => {
    resetToFullyZoomedOut()
  }

  // Mouse down on profile charts (always acts as a vertical pan/drag)
  const handleProfileMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    setDragState({
      isDragging: true,
      isPriceScale: false,
      isProfileDrag: true,
      startX: event.clientX,
      startY: event.clientY,
      initialYDomain: [...yDomain] as [number, number],
      initialXRange: [...xRange] as [number, number],
    })
  }

  // ─── D3 Rendering ───
  useEffect(() => {
    if (!candleSvgRef.current || yDomain[0] === 0) return
    if (!isGexOverlayEnabled && (!gexSvgRef.current || !volSvgRef.current)) return

    const isCollapsed = isCandlesCollapsed
    const margin = isCollapsed
      ? { top: 20, right: 45, bottom: 40, left: 10 }
      : { top: 20, right: 45, bottom: 40, left: 15 }
    const marginRotated = { top: 15, right: 40, bottom: 35, left: 55 }
    const chartHeight = dimensions.height - margin.top - margin.bottom

    const totalWidth = dimensions.width
    const candleWidth = isGexOverlayEnabled
      ? totalWidth
      : (isCollapsed ? 75 : totalWidth * 0.5)

    let gexWidth = isGexOverlayEnabled
      ? 0
      : (isCollapsed ? (totalWidth - 75) / 2 : totalWidth * 0.25)
    let volWidth = isGexOverlayEnabled
      ? 0
      : (isCollapsed ? (totalWidth - 75) / 2 : totalWidth * 0.25)
    let gexHeight = dimensions.height
    let volHeight = dimensions.height

    if (isRotated) {
      gexWidth = isGexOverlayEnabled ? 0 : (isCollapsed ? (totalWidth - 75) : totalWidth * 0.5)
      volWidth = isGexOverlayEnabled ? 0 : (isCollapsed ? (totalWidth - 75) : totalWidth * 0.5)
      gexHeight = dimensions.height / 2
      volHeight = dimensions.height / 2
    }

    const candleSvg = d3.select(candleSvgRef.current)
    const gexSvg = !isGexOverlayEnabled ? d3.select(gexSvgRef.current) : null
    const volSvg = !isGexOverlayEnabled ? d3.select(volSvgRef.current) : null


    // Clear previous elements
    candleSvg.selectAll('*').remove()
    if (!isGexOverlayEnabled && gexSvg && volSvg) {
      gexSvg.selectAll('*').remove()
      volSvg.selectAll('*').remove()
    }

    // Dimensions
    candleSvg.attr('width', candleWidth).attr('height', dimensions.height)
    if (!isGexOverlayEnabled && gexSvg && volSvg) {
      gexSvg.attr('width', gexWidth).attr('height', gexHeight)
      volSvg.attr('width', volWidth).attr('height', volHeight)
    }

    // Shared Y scale (Strike Price)
    const yScale = d3.scaleLinear()
      .domain(yDomain)
      .range([chartHeight, 0])

    // Find the nearest significant GEX cluster (within 1.5% of spot)
    const localizedRange = endSpotPrice * 0.015;
    const localizedProfile = endGexProfile.filter(p => Math.abs(p.strike - endSpotPrice) <= localizedRange);
    const maxGexStrikeObj = (localizedProfile.length > 0 ? localizedProfile : endGexProfile).reduce((max, current) => {
      return Math.abs(current.gex) > Math.abs(max.gex) ? current : max;
    }, { strike: 0, gex: 0 });

    const maxGexStrike = maxGexStrikeObj.strike;
    const maxGexVal = maxGexStrikeObj.gex;

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

      if (!isCollapsed || isGexOverlayEnabled) {
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
          .text(`${symbol}${endSpotPrice.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`)

        const xScale = d3.scaleBand()
          .domain(visibleCandlesData.map((_, i) => i.toString()))
          .range([0, width])
          .padding(0.25)

        const leftProfileData = leftProfileDataCombined.filter(p => p.strike >= yDomain[0] && p.strike <= yDomain[1])

        // Draw GEX Heat Bands (Background stripes) when overlay mode is enabled
        if (isGexOverlayEnabled) {
          leftProfileData.forEach(p => {
            const y = yScale(p.strike)
            if (y === undefined || y < 0 || y > chartHeight) return

            const isPos = p.endNetVal >= 0
            const color = isPos ? '#00ff66' : '#ff3366'
            const absVal = Math.abs(p.endNetVal)
            // Calculate opacity: max opacity 0.08, min 0.0
            const opacity = Math.min(0.08, (absVal / tickerGexMax) * 0.12)

            if (opacity > 0.002) {
              g.append('rect')
                .attr('x', 0)
                .attr('y', y - 4) // centering height
                .attr('width', width)
                .attr('height', 8)
                .attr('fill', color)
                .attr('opacity', opacity)
                .attr('pointer-events', 'none')
            }
          })
        }

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

        // Draw Mini Profile Overlays when overlay mode is enabled
        if (isGexOverlayEnabled) {
          // 1. Left Profile (GEX in 'gamma-vol' mode, Vanna in 'vanna-charm' mode) on the right edge
          const visibleMaxGex = showAbsolute
            ? (d3.max(leftProfileData, p => Math.max(p.endCallVal, Math.abs(p.endPutVal))) || 0.01)
            : (d3.max(leftProfileData, p => Math.abs(p.endNetVal)) || 0.01)

          leftProfileData.forEach(p => {
            const y = yScale(p.strike)
            if (y === undefined || y < 0 || y > chartHeight) return

            const isGammaMode = displayMode === 'gamma-vol'
            const maxBarWidth = width * 0.5

            if (showAbsolute) {
              // Call bar (top half of strike row)
              const callVal = p.endCallVal
              const callWidth = (callVal / visibleMaxGex) * maxBarWidth
              const callColor = isGammaMode ? '#00ff66' : '#00e5ff'
              if (callWidth > 1) {
                g.append('rect')
                  .attr('x', width - callWidth)
                  .attr('y', y - 3.5)
                  .attr('width', callWidth)
                  .attr('height', 3)
                  .attr('fill', callColor)
                  .attr('opacity', isGammaMode ? 0.45 : 0.4)
                  .attr('rx', 1)
                  .attr('pointer-events', 'none')
              }

              // Put bar (bottom half of strike row)
              const putVal = Math.abs(p.endPutVal)
              const putWidth = (putVal / visibleMaxGex) * maxBarWidth
              const putColor = isGammaMode ? '#ff3366' : '#ff00ff'
              if (putWidth > 1) {
                g.append('rect')
                  .attr('x', width - putWidth)
                  .attr('y', y + 0.5)
                  .attr('width', putWidth)
                  .attr('height', 3)
                  .attr('fill', putColor)
                  .attr('opacity', isGammaMode ? 0.45 : 0.4)
                  .attr('rx', 1)
                  .attr('pointer-events', 'none')
              }
            } else {
              // Net Mode
              const isPos = p.endNetVal >= 0
              const color = isGammaMode 
                ? (isPos ? '#00ff66' : '#ff3366') 
                : (isPos ? '#00e5ff' : '#ff00ff')
              
              const absVal = Math.abs(p.endNetVal)
              const barWidth = (absVal / visibleMaxGex) * maxBarWidth

              if (barWidth > 1) {
                g.append('rect')
                  .attr('x', width - barWidth)
                  .attr('y', y - 3)
                  .attr('width', barWidth)
                  .attr('height', 6)
                  .attr('fill', color)
                  .attr('opacity', isGammaMode ? 0.4 : 0.35)
                  .attr('rx', 1.5)
                  .attr('pointer-events', 'none')
              }
            }
          })

          // 2. Right Profile (Volume in 'gamma-vol' mode, Charm in 'vanna-charm' mode) on the left edge
          {
            const rightProfileData = rightProfileDataCombined.filter(p => p.strike >= yDomain[0] && p.strike <= yDomain[1])
            const visibleMaxRight = showAbsolute
              ? (d3.max(rightProfileData, p => Math.max(p.endCallVal, Math.abs(p.endPutVal))) || 0.01)
              : (d3.max(rightProfileData, p => Math.abs(p.endNetVal)) || 0.01)
            const isGammaMode = displayMode === 'gamma-vol'
            const maxBarWidth = width * 0.5
            
            rightProfileData.forEach(p => {
              const y = yScale(p.strike)
              if (y === undefined || y < 0 || y > chartHeight) return

              if (showAbsolute) {
                // Call bar (top half of strike row)
                const callVal = p.endCallVal
                const callWidth = (callVal / visibleMaxRight) * maxBarWidth
                const callColor = isGammaMode ? '#00ff66' : '#ffff00'
                if (callWidth > 1) {
                  g.append('rect')
                    .attr('x', 0)
                    .attr('y', y - 3.5)
                    .attr('width', callWidth)
                    .attr('height', 3)
                    .attr('fill', callColor)
                    .attr('opacity', isGammaMode ? 0.35 : 0.35)
                    .attr('rx', 1)
                    .attr('pointer-events', 'none')
                }

                // Put bar (bottom half of strike row)
                const putVal = Math.abs(p.endPutVal)
                const putWidth = (putVal / visibleMaxRight) * maxBarWidth
                const putColor = isGammaMode ? '#ff3366' : '#ff5500'
                if (putWidth > 1) {
                  g.append('rect')
                    .attr('x', 0)
                    .attr('y', y + 0.5)
                    .attr('width', putWidth)
                    .attr('height', 3)
                    .attr('fill', putColor)
                    .attr('opacity', isGammaMode ? 0.35 : 0.35)
                    .attr('rx', 1)
                    .attr('pointer-events', 'none')
                }
              } else {
                // Net Mode
                const isPos = p.endNetVal >= 0
                const color = isGammaMode
                  ? '#00C8FF'
                  : (isPos ? '#ffff00' : '#ff5500')
                const absVal = Math.abs(p.endNetVal)
                const barWidth = (absVal / visibleMaxRight) * maxBarWidth

                if (barWidth > 1) {
                  g.append('rect')
                    .attr('x', 0)
                    .attr('y', y - 3)
                    .attr('width', barWidth)
                    .attr('height', 6)
                    .attr('fill', color)
                    .attr('opacity', isGammaMode ? 0.25 : 0.3)
                    .attr('rx', 1.5)
                    .attr('pointer-events', 'none')
                }
              }
            })
          }

          // Dynamic Pinning Magnetic Pull Vector / Gravity Well
          if (maxGexStrike > 0 && (isGexOverlayEnabled || isCollapsed)) {
            const magnetY = yScale(maxGexStrike)
            const spotY = yScale(endSpotPrice)
            
            if (magnetY >= 0 && magnetY <= chartHeight) {
              const isNegGexMagnet = maxGexVal < 0
              const magnetColor = isNegGexMagnet ? '#ff3366' : '#00ff66'
              const magnetLabel = isNegGexMagnet ? 'GRAVITY WELL' : 'GEX MAGNET'
              const magnetShortLabel = isNegGexMagnet ? 'WELL' : 'PIN'

              // Draw magnet line
              g.append('line')
                .attr('x1', 0)
                .attr('x2', width)
                .attr('y1', magnetY)
                .attr('y2', magnetY)
                .attr('stroke', magnetColor)
                .attr('stroke-width', 1.5)
                .attr('stroke-dasharray', '4,4')
                .attr('opacity', 0.6)
                .attr('class', 'animate-pulse-glow')

              if (isCollapsed) {
                // Compact text label for collapsed mode
                g.append('text')
                  .attr('x', 5)
                  .attr('y', magnetY - 4)
                  .attr('fill', magnetColor)
                  .style('font-family', typography.fontMono)
                  .style('font-size', '8px')
                  .style('font-weight', 'bold')
                  .text(`${magnetShortLabel}: ${maxGexStrike}`)
              } else {
                // Large Badge text container for expanded/fullscreen mode
                g.append('rect')
                  .attr('x', 10)
                  .attr('y', magnetY - 18)
                  .attr('width', 180)
                  .attr('height', 15)
                  .attr('fill', '#050507')
                  .attr('stroke', magnetColor)
                  .attr('stroke-opacity', 0.25)
                  .attr('rx', 3)
                  .attr('opacity', 0.85)

                g.append('text')
                  .attr('x', 16)
                  .attr('y', magnetY - 7)
                  .attr('fill', magnetColor)
                  .style('font-family', typography.fontMono)
                  .style('font-size', '8px')
                  .style('font-weight', 'bold')
                  .text(`${magnetLabel}: ${formatCurrency(maxGexStrike)} (${(Math.abs(maxGexVal)).toFixed(2)}B)`)
              }

              // Pull vector line between spot and magnet (if spot is within 3%)
              if (Math.abs(endSpotPrice - maxGexStrike) / endSpotPrice < 0.03) {
                g.append('line')
                  .attr('x1', width * 0.15)
                  .attr('x2', width * 0.15)
                  .attr('y1', spotY)
                  .attr('y2', magnetY)
                  .attr('stroke', magnetColor)
                  .attr('stroke-width', 1.5)
                  .attr('stroke-dasharray', '2,2')
                  .attr('opacity', 0.45)
                  
                const isBelow = endSpotPrice < maxGexStrike
                g.append('text')
                  .attr('x', width * 0.15 - 5)
                  .attr('y', isBelow ? magnetY + 12 : magnetY - 4)
                  .attr('fill', magnetColor)
                  .style('font-size', '10px')
                  .style('font-weight', 'bold')
                  .text(isBelow ? '▲' : '▼')
                  .style('opacity', 0.85)
              }
            }
          }
        }

        // Draw Call Wall & Put Wall overlay lines if in fullscreen overlay mode
        if (isGexOverlayEnabled && walls.callWall && walls.putWall) {
          const callWallY = yScale(walls.callWall)
          const putWallY = yScale(walls.putWall)

          // Call Wall
          if (callWallY >= 0 && callWallY <= chartHeight) {
            g.append('line')
              .attr('x1', 0)
              .attr('x2', width)
              .attr('y1', callWallY)
              .attr('y2', callWallY)
              .attr('stroke', '#FF3B60')
              .attr('stroke-width', 1.2)
              .attr('stroke-dasharray', '5,5')
              .attr('opacity', 0.75)

            g.append('rect')
              .attr('x', width - 190)
              .attr('y', callWallY - 18)
              .attr('width', 180)
              .attr('height', 15)
              .attr('fill', '#050507')
              .attr('stroke', '#FF3B60')
              .attr('stroke-opacity', 0.25)
              .attr('rx', 3)
              .attr('opacity', 0.85)

            g.append('text')
              .attr('x', width - 184)
              .attr('y', callWallY - 7)
              .attr('fill', '#FF3B60')
              .style('font-family', typography.fontMono)
              .style('font-size', '8px')
              .style('font-weight', 'bold')
              .text(`CALL WALL: ${formatCurrency(walls.callWall)} (Touch: ${wallTouchProbabilities.callWallTouch}%)`)
          }

          // Put Wall
          if (putWallY >= 0 && putWallY <= chartHeight) {
            g.append('line')
              .attr('x1', 0)
              .attr('x2', width)
              .attr('y1', putWallY)
              .attr('y2', putWallY)
              .attr('stroke', '#00C805')
              .attr('stroke-width', 1.2)
              .attr('stroke-dasharray', '5,5')
              .attr('opacity', 0.75)

            g.append('rect')
              .attr('x', width - 190)
              .attr('y', putWallY - 18)
              .attr('width', 180)
              .attr('height', 15)
              .attr('fill', '#050507')
              .attr('stroke', '#00C805')
              .attr('stroke-opacity', 0.25)
              .attr('rx', 3)
              .attr('opacity', 0.85)

            g.append('text')
              .attr('x', width - 184)
              .attr('y', putWallY - 7)
              .attr('fill', '#00C805')
              .style('font-family', typography.fontMono)
              .style('font-size', '8px')
              .style('font-weight', 'bold')
              .text(`PUT WALL: ${formatCurrency(walls.putWall)} (Touch: ${wallTouchProbabilities.putWallTouch}%)`)
          }
        }

        if (isGexOverlayEnabled) {
          g.append('rect')
            .attr('width', width)
            .attr('height', chartHeight)
            .attr('fill', 'transparent')
            .on('mousemove', (event) => {
              const [mx, my] = d3.pointer(event)
              const price = yScale.invert(my)
              const isLeftHalf = mx < width * 0.5

              if (isLeftHalf) {
                // Show Volume / Charm tooltip
                const rightProfileData = rightProfileDataCombined.filter(p => p.strike >= yDomain[0] && p.strike <= yDomain[1])
                const closest = rightProfileData.reduce((prev, curr) => {
                  return Math.abs(curr.strike - price) < Math.abs(prev.strike - price) ? curr : prev
                }, rightProfileData[0])

                if (closest && tooltipRef.current && containerRef.current) {
                  const containerRect = containerRef.current.getBoundingClientRect()
                  const isVolMode = displayMode === 'gamma-vol'
                  const symbol = market === 'INDIA' ? '₹' : '$'
                  const formattedStrike = `${symbol}${closest.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  const headerTitle = isVolMode
                    ? 'Volume Profile'
                    : (showAbsolute ? 'Charm Profile (ABS)' : 'Charm Profile (NET)')

                  let htmlContent = `
                    <div class="flex items-center justify-between border-b border-[#222]/40 pb-1.5 mb-1 flex-row gap-6">
                      <span class="text-[10px] font-mono font-bold text-[#E5E5E5] uppercase tracking-wider">${headerTitle}</span>
                      <span class="text-[10px] font-mono text-[#00C805] font-bold">Strike ${formattedStrike}</span>
                    </div>
                  `
                  if (isVolMode) {
                    const startText = closest.startNetVal.toLocaleString() + ' contracts'
                    const endText = closest.endNetVal.toLocaleString() + ' contracts'
                    const deltaVal = closest.endNetVal - closest.startNetVal
                    const deltaText = (deltaVal >= 0 ? '+' : '') + deltaVal.toLocaleString() + ' contracts'

                    if (isLive) {
                      htmlContent += `
                        <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                          <span class="text-[#949494]">Volume</span>
                          <span class="text-[#00C8FF] font-bold">${endText}</span>
                        </div>
                      `
                    } else {
                      htmlContent += `
                        <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                          <span class="text-[#949494]">Start Volume</span>
                          <span class="text-[#949494]">${startText}</span>
                        </div>
                        <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                          <span class="text-[#949494]">End Volume</span>
                          <span class="text-[#E5E5E5] font-bold">${endText}</span>
                        </div>
                        <div class="flex items-center justify-between text-[10px] font-mono border-t border-[#222]/20 pt-1.5 mt-0.5 flex-row gap-6">
                          <span class="text-[#949494]">Change</span>
                          <span class="font-bold ${deltaVal >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaText}</span>
                        </div>
                      `
                    }
                  } else {
                    if (showAbsolute) {
                      if (isLive) {
                        htmlContent += `
                          <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                            <span class="text-[#949494]">Call Charm</span>
                            <span class="text-[#00C805] font-bold">${formatBillions(closest.endCallVal)}</span>
                          </div>
                          <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                            <span class="text-[#949494]">Put Charm</span>
                            <span class="text-[#FF3B60] font-bold">${formatBillions(Math.abs(closest.endPutVal))}</span>
                          </div>
                        `
                      } else {
                        const deltaCall = closest.endCallVal - closest.startCallVal
                        const deltaPut = Math.abs(closest.endPutVal) - Math.abs(closest.startPutVal)
                        htmlContent += `
                          <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                            <span class="text-[#949494]">Start Call/Put</span>
                            <span class="text-[#949494]">${formatBillions(closest.startCallVal)} / ${formatBillions(Math.abs(closest.startPutVal))}</span>
                          </div>
                          <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                            <span class="text-[#949494]">End Call/Put</span>
                            <span class="text-[#E5E5E5]">${formatBillions(closest.endCallVal)} / ${formatBillions(Math.abs(closest.endPutVal))}</span>
                          </div>
                          <div class="flex items-center justify-between text-[10px] font-mono border-t border-[#222]/20 pt-1.5 mt-0.5 flex-row gap-6">
                            <span class="text-[#949494]">Call Change</span>
                            <span class="font-bold ${deltaCall >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaCall >= 0 ? '+' : ''}${formatBillions(deltaCall)}</span>
                          </div>
                          <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                            <span class="text-[#949494]">Put Change</span>
                            <span class="font-bold ${deltaPut >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaPut >= 0 ? '+' : ''}${formatBillions(deltaPut)}</span>
                          </div>
                        `
                      }
                    } else {
                      if (isLive) {
                        htmlContent += `
                          <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                            <span class="text-[#949494]">Net Charm</span>
                            <span class="font-bold ${closest.endNetVal >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${formatBillions(closest.endNetVal)}</span>
                          </div>
                        `
                      } else {
                        const deltaNet = closest.endNetVal - closest.startNetVal
                        htmlContent += `
                          <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                            <span class="text-[#949494]">Start Net Charm</span>
                            <span class="text-[#949494]">${formatBillions(closest.startNetVal)}</span>
                          </div>
                          <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                            <span class="text-[#949494]">End Net Charm</span>
                            <span class="text-[#E5E5E5] font-bold">${formatBillions(closest.endNetVal)}</span>
                          </div>
                          <div class="flex items-center justify-between text-[10px] font-mono border-t border-[#222]/20 pt-1.5 mt-0.5 flex-row gap-6">
                            <span class="text-[#949494]">Change</span>
                            <span class="font-bold ${deltaNet >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaNet >= 0 ? '+' : ''}${formatBillions(deltaNet)}</span>
                          </div>
                        `
                      }
                    }
                  }
                  tooltipRef.current.innerHTML = htmlContent
                  tooltipRef.current.style.opacity = '1'

                  const relX = event.clientX - containerRect.left
                  const relY = event.clientY - containerRect.top

                  if (relX > containerRect.width - 280) {
                    tooltipRef.current.style.left = `${relX - 14}px`
                    tooltipRef.current.style.transform = 'translateX(-100%)'
                  } else {
                    tooltipRef.current.style.left = `${relX + 14}px`
                    tooltipRef.current.style.transform = 'none'
                  }

                  if (relY < 120) {
                    tooltipRef.current.style.top = `${relY + 20}px`
                  } else if (relY > containerRect.height - 120) {
                    tooltipRef.current.style.top = `${relY - 120}px`
                  } else {
                    tooltipRef.current.style.top = `${relY - 50}px`
                  }
                }
              } else {
                // Show GEX / Vanna tooltip
                const closest = leftProfileData.reduce((prev, curr) => {
                  return Math.abs(curr.strike - price) < Math.abs(prev.strike - price) ? curr : prev
                }, leftProfileData[0])

                if (closest && tooltipRef.current && containerRef.current) {
                  const containerRect = containerRef.current.getBoundingClientRect()
                  const isGamma = displayMode === 'gamma-vol'
                  const greekLabel = isGamma ? 'GEX' : 'Vanna'
                  const symbol = market === 'INDIA' ? '₹' : '$'
                  const formattedStrike = `${symbol}${closest.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  const headerTitle = isGamma
                    ? (showAbsolute ? 'GEX Profile (ABS)' : 'GEX Profile (NET)')
                    : (showAbsolute ? 'Vanna Profile (ABS)' : 'Vanna Profile (NET)')

                  let htmlContent = `
                    <div class="flex items-center justify-between border-b border-[#222]/40 pb-1.5 mb-1 flex-row gap-6">
                      <span class="text-[10px] font-mono font-bold text-[#E5E5E5] uppercase tracking-wider">${headerTitle}</span>
                      <span class="text-[10px] font-mono text-[#00C805] font-bold">Strike ${formattedStrike}</span>
                    </div>
                  `
                  if (showAbsolute) {
                    if (isLive) {
                      htmlContent += `
                        <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                          <span class="text-[#949494]">Call ${greekLabel}</span>
                          <span class="text-[#00C805] font-bold">${formatBillions(closest.endCallVal)}</span>
                        </div>
                        <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                          <span class="text-[#949494]">Put ${greekLabel}</span>
                          <span class="text-[#FF3B60] font-bold">${formatBillions(Math.abs(closest.endPutVal))}</span>
                        </div>
                      `
                    } else {
                      const deltaCall = closest.endCallVal - closest.startCallVal
                      const deltaPut = Math.abs(closest.endPutVal) - Math.abs(closest.startPutVal)
                      htmlContent += `
                        <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                          <span class="text-[#949494]">Start Call/Put</span>
                          <span class="text-[#949494]">${formatBillions(closest.startCallVal)} / ${formatBillions(Math.abs(closest.startPutVal))}</span>
                        </div>
                        <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                          <span class="text-[#949494]">End Call/Put</span>
                          <span class="text-[#E5E5E5]">${formatBillions(closest.endCallVal)} / ${formatBillions(Math.abs(closest.endPutVal))}</span>
                        </div>
                        <div class="flex items-center justify-between text-[10px] font-mono border-t border-[#222]/20 pt-1.5 mt-0.5 flex-row gap-6">
                          <span class="text-[#949494]">Call Change</span>
                          <span class="font-bold ${deltaCall >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaCall >= 0 ? '+' : ''}${formatBillions(deltaCall)}</span>
                        </div>
                        <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                          <span class="text-[#949494]">Put Change</span>
                          <span class="font-bold ${deltaPut >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaPut >= 0 ? '+' : ''}${formatBillions(deltaPut)}</span>
                        </div>
                      `
                    }
                  } else {
                    if (isLive) {
                      htmlContent += `
                        <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                          <span class="text-[#949494]">Net ${greekLabel}</span>
                          <span class="font-bold ${closest.endNetVal >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${formatBillions(closest.endNetVal)}</span>
                        </div>
                      `
                    } else {
                      const deltaNet = closest.endNetVal - closest.startNetVal
                      htmlContent += `
                        <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                          <span class="text-[#949494]">Start Net ${greekLabel}</span>
                          <span class="text-[#949494]">${formatBillions(closest.startNetVal)}</span>
                        </div>
                        <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                          <span class="text-[#949494]">End Net ${greekLabel}</span>
                          <span class="text-[#E5E5E5] font-bold">${formatBillions(closest.endNetVal)}</span>
                        </div>
                        <div class="flex items-center justify-between text-[10px] font-mono border-t border-[#222]/20 pt-1.5 mt-0.5 flex-row gap-6">
                          <span class="text-[#949494]">Change</span>
                          <span class="font-bold ${deltaNet >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaNet >= 0 ? '+' : ''}${formatBillions(deltaNet)}</span>
                        </div>
                      `
                    }
                  }
                  tooltipRef.current.innerHTML = htmlContent
                  tooltipRef.current.style.opacity = '1'

                  const relX = event.clientX - containerRect.left
                  const relY = event.clientY - containerRect.top

                  if (relX > containerRect.width - 280) {
                    tooltipRef.current.style.left = `${relX - 14}px`
                    tooltipRef.current.style.transform = 'translateX(-100%)'
                  } else {
                    tooltipRef.current.style.left = `${relX + 14}px`
                    tooltipRef.current.style.transform = 'none'
                  }

                  if (relY < 120) {
                    tooltipRef.current.style.top = `${relY + 20}px`
                  } else if (relY > containerRect.height - 120) {
                    tooltipRef.current.style.top = `${relY - 120}px`
                  } else {
                    tooltipRef.current.style.top = `${relY - 50}px`
                  }
                }
              }
            })
            .on('mouseleave', hideCrosshairs)
        }
      }

      // Y Axis on the RIGHT side of the Candlestick chart (Always rendered to show Strikes)
      const yAxis = d3.axisRight(yScale).tickValues(yTicks).tickFormat(d => formatCurrency(d as number))
      const yAxisG = g.append('g').attr('transform', `translate(${width}, 0)`).call(yAxis)
      yAxisG.selectAll('line').attr('stroke', '#222')
      yAxisG.selectAll('path').attr('stroke', 'none')
      yAxisG.selectAll('text').attr('fill', '#B5B5B5').style('font-family', typography.fontMono).style('font-size', '9px').attr('dx', '3px')

      // X Axis (Time) with dynamic step sizing and TradingView style day transitions
      if (!isCollapsed || isGexOverlayEnabled) {
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
        
        // Add solid background rect to cover bleeding wicks
        xAxisG.insert('rect', ':first-child')
          .attr('x', -margin.left)
          .attr('y', 0)
          .attr('width', width + margin.left + margin.right)
          .attr('height', margin.bottom)
          .attr('fill', '#000000')
          .style('cursor', 'ew-resize');

        xAxisG.selectAll('line').attr('stroke', 'none');
        xAxisG.selectAll('path').attr('stroke', '#1A1A1A');

        xAxisG.selectAll('text')
          .attr('fill', function () {
            const txt = d3.select(this).text();
            return txt.includes(':') ? '#5E5E62' : '#E5E5EA';
          })
          .style('font-weight', function () {
            const txt = d3.select(this).text();
            return txt.includes(':') ? 'normal' : 'bold';
          })
          .style('font-family', typography.fontSans)
          .style('font-size', '9px')
          .attr('dy', '10px');
      }
    }

    // ─── 2. LEFT PROFILE CHART (GEX/VEX) ───
    if (!isGexOverlayEnabled && gexSvg) {
      const currentMargin = isRotated ? marginRotated : margin
      const chartWidth = gexWidth - currentMargin.left - currentMargin.right
      const chartHeight = gexHeight - currentMargin.top - currentMargin.bottom

      const g = gexSvg.append('g').attr('transform', `translate(${currentMargin.left},${currentMargin.top})`)

      const leftProfileData = leftProfileDataCombined.filter(p => p.strike >= yDomain[0] && p.strike <= yDomain[1])

      // Ticker-aware scale: max GEX across all strikes + 25% headroom, rounded to 200M
      const leftMax = tickerGexMax

      const xScale = d3.scaleLinear()
        .domain([-leftMax, leftMax])
        .range([0, chartWidth])

      const strikeScale = d3.scaleLinear()
        .domain(yDomain)
        .range([0, chartWidth])

      const exposureScale = d3.scaleLinear()
        .domain([-leftMax, leftMax])
        .range([chartHeight, 0])

      // Append definitions for striped patterns
      const defs = gexSvg.append('defs')

      defs.append('pattern')
        .attr('id', 'increase-stripes-left')
        .attr('width', 6)
        .attr('height', 6)
        .attr('patternUnits', 'userSpaceOnUse')
        .call(p => {
          p.append('rect')
            .attr('width', 6)
            .attr('height', 6)
            .attr('fill', 'rgba(0, 200, 5, 0.15)')
          p.append('path')
            .attr('d', 'M-1,1 L1,-1 M0,6 L6,0 M5,7 L7,5')
            .attr('stroke', '#00C805')
            .attr('stroke-width', 1.2)
            .attr('fill', 'none')
        })

      defs.append('pattern')
        .attr('id', 'decrease-stripes-left')
        .attr('width', 6)
        .attr('height', 6)
        .attr('patternUnits', 'userSpaceOnUse')
        .call(p => {
          p.append('rect')
            .attr('width', 6)
            .attr('height', 6)
            .attr('fill', 'rgba(255, 59, 96, 0.15)')
          p.append('path')
            .attr('d', 'M-1,1 L1,-1 M0,6 L6,0 M5,7 L7,5')
            .attr('stroke', '#FF3B60')
            .attr('stroke-width', 1.2)
            .attr('fill', 'none')
        })

      // Zero-exposure center line
      if (isRotated) {
        g.append('line')
          .attr('x1', 0).attr('x2', chartWidth)
          .attr('y1', exposureScale(0)).attr('y2', exposureScale(0))
          .attr('stroke', '#222').attr('stroke-width', 1)
      } else {
        g.append('line')
          .attr('x1', xScale(0)).attr('x2', xScale(0))
          .attr('y1', 0).attr('y2', chartHeight)
          .attr('stroke', '#222').attr('stroke-width', 1)
      }

      // Use static doubled bar thickness / width to keep it clean and robust
      const dynamicBarThickness = 14
      const dynamicBarWidth = 14
      const dynamicBarOffset = 7

      // Draw bars
      leftProfileData.forEach(p => {
        if (isRotated) {
          const x = strikeScale(p.strike)
          if (x === undefined || x < 0 || x > chartWidth) return
          const barWidth = dynamicBarWidth
          const barX = x - barWidth / 2

          if (showAbsolute) {
            if (!isLive) {
              // Start Call bar (Solid green, 35% opacity)
              const startCallHeight = Math.abs(exposureScale(p.startCallVal) - exposureScale(0))
              g.append('rect')
                .attr('x', barX).attr('y', exposureScale(p.startCallVal))
                .attr('width', barWidth).attr('height', Math.max(1, startCallHeight))
                .attr('fill', 'rgba(0, 200, 5, 0.3)')
                .attr('stroke', '#00C805').attr('stroke-opacity', 0.3).attr('stroke-width', 0.5).attr('rx', 1)

              // Start Put bar (Solid red, 35% opacity)
              const startPutHeight = Math.abs(exposureScale(p.startPutVal) - exposureScale(0))
              g.append('rect')
                .attr('x', barX).attr('y', exposureScale(0))
                .attr('width', barWidth).attr('height', Math.max(1, startPutHeight))
                .attr('fill', 'rgba(255, 59, 96, 0.3)')
                .attr('stroke', '#FF3B60').attr('stroke-opacity', 0.3).attr('stroke-width', 0.5).attr('rx', 1)
            }

            // End Call bar (Solid green, 80% opacity)
            const endCallHeight = Math.abs(exposureScale(p.endCallVal) - exposureScale(0))
            g.append('rect')
              .attr('x', barX).attr('y', exposureScale(p.endCallVal))
              .attr('width', barWidth).attr('height', Math.max(1, endCallHeight))
              .attr('fill', 'rgba(0, 200, 5, 0.65)')
              .attr('stroke', '#00C805').attr('stroke-opacity', 0.65).attr('stroke-width', 0.5).attr('rx', 1)

            // End Put bar (Solid red, 80% opacity)
            const endPutHeight = Math.abs(exposureScale(p.endPutVal) - exposureScale(0))
            g.append('rect')
              .attr('x', barX).attr('y', exposureScale(0))
              .attr('width', barWidth).attr('height', Math.max(1, endPutHeight))
              .attr('fill', 'rgba(255, 59, 96, 0.65)')
              .attr('stroke', '#FF3B60').attr('stroke-opacity', 0.65).attr('stroke-width', 0.5).attr('rx', 1)

            if (!isLive) {
              // Delta Call change bar
              const deltaCall = p.endCallVal - p.startCallVal
              if (Math.abs(deltaCall) > 1e-5) {
                const deltaHeight = Math.abs(exposureScale(p.endCallVal) - exposureScale(p.startCallVal))
                const deltaY = exposureScale(Math.max(p.startCallVal, p.endCallVal))
                g.append('rect')
                  .attr('x', barX).attr('y', deltaY)
                  .attr('width', barWidth).attr('height', Math.max(1, deltaHeight))
                  .attr('fill', deltaCall >= 0 ? 'url(#increase-stripes-left)' : 'url(#decrease-stripes-left)')
                  .attr('stroke', deltaCall >= 0 ? '#00C805' : '#FF3B60')
                  .attr('stroke-opacity', 0.95).attr('stroke-width', 0.5).attr('rx', 1)
              }

              // Delta Put change bar (magnitude change)
              const deltaPutRaw = Math.abs(p.endPutVal) - Math.abs(p.startPutVal)
              const deltaPutHeight = Math.abs(exposureScale(p.endPutVal) - exposureScale(p.startPutVal))
              const deltaPutY = exposureScale(Math.max(p.startPutVal, p.endPutVal))
              if (Math.abs(deltaPutRaw) > 1e-5) {
                g.append('rect')
                  .attr('x', barX).attr('y', deltaPutY)
                  .attr('width', barWidth).attr('height', Math.max(1, deltaPutHeight))
                  .attr('fill', deltaPutRaw >= 0 ? 'url(#increase-stripes-left)' : 'url(#decrease-stripes-left)')
                  .attr('stroke', deltaPutRaw >= 0 ? '#00C805' : '#FF3B60')
                  .attr('stroke-opacity', 0.95).attr('stroke-width', 0.5).attr('rx', 1)
              }
            }
          } else {
            // Net Mode
            const startVal = p.startNetVal
            const endVal = p.endNetVal
            const delta = endVal - startVal

            if (!isLive) {
              const startHeight = Math.abs(exposureScale(startVal) - exposureScale(0))
              const startY = Math.min(exposureScale(0), exposureScale(startVal))
              g.append('rect')
                .attr('x', barX).attr('y', startY)
                .attr('width', barWidth).attr('height', Math.max(1, startHeight))
                .attr('fill', startVal >= 0 ? 'rgba(0, 200, 5, 0.3)' : 'rgba(255, 59, 96, 0.3)')
                .attr('stroke', startVal >= 0 ? '#00C805' : '#FF3B60')
                .attr('stroke-opacity', 0.3).attr('stroke-width', 0.5).attr('rx', 1)
            }

            const endHeight = Math.abs(exposureScale(endVal) - exposureScale(0))
            const endY = Math.min(exposureScale(0), exposureScale(endVal))
            g.append('rect')
              .attr('x', barX).attr('y', endY)
              .attr('width', barWidth).attr('height', Math.max(1, endHeight))
              .attr('fill', endVal >= 0 ? 'rgba(0, 200, 5, 0.65)' : 'rgba(255, 59, 96, 0.65)')
              .attr('stroke', endVal >= 0 ? '#00C805' : '#FF3B60')
              .attr('stroke-opacity', 0.65).attr('stroke-width', 0.5).attr('rx', 1)

            if (!isLive && Math.abs(delta) > 1e-5) {
              const deltaHeight = Math.abs(exposureScale(endVal) - exposureScale(startVal))
              const deltaY = exposureScale(Math.max(startVal, endVal))
              g.append('rect')
                .attr('x', barX).attr('y', deltaY)
                .attr('width', barWidth).attr('height', Math.max(1, deltaHeight))
                .attr('fill', delta >= 0 ? 'url(#increase-stripes-left)' : 'url(#decrease-stripes-left)')
                .attr('stroke', delta >= 0 ? '#00C805' : '#FF3B60')
                .attr('stroke-opacity', 0.95).attr('stroke-width', 0.5).attr('rx', 1)
            }
          }
        } else {
          // Standard mode (horizontal bars)
          const y = yScale(p.strike)
          if (y === undefined || y < 0 || y > chartHeight) return

          if (showAbsolute) {
            // Absolute Mode: Draw Call bars (green, right) and Put bars (red, left)
            if (!isLive) {
              // Start Call bar (Solid green, 35% opacity)
              const startCallWidth = Math.abs(xScale(p.startCallVal) - xScale(0))
              g.append('rect')
                .attr('x', xScale(0)).attr('y', y - dynamicBarOffset)
                .attr('width', Math.max(1, startCallWidth))
                .attr('height', dynamicBarThickness)
                .attr('fill', 'rgba(0, 200, 5, 0.3)')
                .attr('stroke', '#00C805')
                .attr('stroke-opacity', 0.3)
                .attr('stroke-width', 0.5)
                .attr('rx', 1)

              // Start Put bar (Solid red, 35% opacity)
              const startPutWidth = Math.abs(xScale(p.startPutVal) - xScale(0))
              g.append('rect')
                .attr('x', xScale(p.startPutVal)).attr('y', y - dynamicBarOffset)
                .attr('width', Math.max(1, startPutWidth))
                .attr('height', dynamicBarThickness)
                .attr('fill', 'rgba(255, 59, 96, 0.3)')
                .attr('stroke', '#FF3B60')
                .attr('stroke-opacity', 0.3)
                .attr('stroke-width', 0.5)
                .attr('rx', 1)
            }

            // End Call bar (Solid green, 80% opacity)
            const endCallWidth = Math.abs(xScale(p.endCallVal) - xScale(0))
            g.append('rect')
              .attr('x', xScale(0)).attr('y', y - dynamicBarOffset)
              .attr('width', Math.max(1, endCallWidth))
              .attr('height', dynamicBarThickness)
              .attr('fill', 'rgba(0, 200, 5, 0.65)')
              .attr('stroke', '#00C805')
              .attr('stroke-opacity', 0.65)
              .attr('stroke-width', 0.5)
              .attr('rx', 1)

            // End Put bar (Solid red, 80% opacity)
            const endPutWidth = Math.abs(xScale(p.endPutVal) - xScale(0))
            g.append('rect')
              .attr('x', xScale(p.endPutVal)).attr('y', y - dynamicBarOffset)
              .attr('width', Math.max(1, endPutWidth))
              .attr('height', dynamicBarThickness)
              .attr('fill', 'rgba(255, 59, 96, 0.65)')
              .attr('stroke', '#FF3B60')
              .attr('stroke-opacity', 0.65)
              .attr('stroke-width', 0.5)
              .attr('rx', 1)

            if (!isLive) {
              // Delta Call change bar
              const deltaCall = p.endCallVal - p.startCallVal
              if (Math.abs(deltaCall) > 1e-5) {
                const deltaWidth = Math.abs(xScale(p.endCallVal) - xScale(p.startCallVal))
                const deltaX = xScale(Math.min(p.startCallVal, p.endCallVal))
                g.append('rect')
                  .attr('x', deltaX).attr('y', y - dynamicBarOffset)
                  .attr('width', Math.max(1, deltaWidth))
                  .attr('height', dynamicBarThickness)
                  .attr('fill', deltaCall >= 0 ? 'url(#increase-stripes-left)' : 'url(#decrease-stripes-left)')
                  .attr('stroke', deltaCall >= 0 ? '#00C805' : '#FF3B60')
                  .attr('stroke-opacity', 0.95)
                  .attr('stroke-width', 0.5)
                  .attr('rx', 1)
              }

              // Delta Put change bar (magnitude change)
              const deltaPutRaw = Math.abs(p.endPutVal) - Math.abs(p.startPutVal)
              const deltaPutWidth = Math.abs(xScale(p.endPutVal) - xScale(p.startPutVal))
              const deltaPutX = xScale(Math.min(p.startPutVal, p.endPutVal))
              if (Math.abs(deltaPutRaw) > 1e-5) {
                g.append('rect')
                  .attr('x', deltaPutX).attr('y', y - dynamicBarOffset)
                  .attr('width', Math.max(1, deltaPutWidth))
                  .attr('height', dynamicBarThickness)
                  .attr('fill', deltaPutRaw >= 0 ? 'url(#increase-stripes-left)' : 'url(#decrease-stripes-left)')
                  .attr('stroke', deltaPutRaw >= 0 ? '#00C805' : '#FF3B60')
                  .attr('stroke-opacity', 0.95)
                  .attr('stroke-width', 0.5)
                  .attr('rx', 1)
              }
            }
          } else {
            // Net Mode
            const startVal = p.startNetVal
            const endVal = p.endNetVal
            const delta = endVal - startVal

            if (!isLive) {
              const startWidth = Math.abs(xScale(startVal) - xScale(0))
              const startX = startVal >= 0 ? xScale(0) : xScale(startVal)
              g.append('rect')
                .attr('x', startX).attr('y', y - dynamicBarOffset)
                .attr('width', Math.max(1, startWidth))
                .attr('height', dynamicBarThickness)
                .attr('fill', startVal >= 0 ? 'rgba(0, 200, 5, 0.3)' : 'rgba(255, 59, 96, 0.3)')
                .attr('stroke', startVal >= 0 ? '#00C805' : '#FF3B60')
                .attr('stroke-opacity', 0.3)
                .attr('stroke-width', 0.5)
                .attr('rx', 1)
            }

            const endWidth = Math.abs(xScale(endVal) - xScale(0))
            const endX = endVal >= 0 ? xScale(0) : xScale(endVal)
            g.append('rect')
              .attr('x', endX).attr('y', y - dynamicBarOffset)
              .attr('width', Math.max(1, endWidth))
              .attr('height', dynamicBarThickness)
              .attr('fill', endVal >= 0 ? 'rgba(0, 200, 5, 0.65)' : 'rgba(255, 59, 96, 0.65)')
              .attr('stroke', endVal >= 0 ? '#00C805' : '#FF3B60')
              .attr('stroke-opacity', 0.65)
              .attr('stroke-width', 0.5)
              .attr('rx', 1)

            if (!isLive && Math.abs(delta) > 1e-5) {
              const deltaWidth = Math.abs(xScale(endVal) - xScale(startVal))
              const deltaX = xScale(Math.min(startVal, endVal))
              g.append('rect')
                .attr('x', deltaX).attr('y', y - dynamicBarOffset)
                .attr('width', Math.max(1, deltaWidth))
                .attr('height', dynamicBarThickness)
                .attr('fill', delta >= 0 ? 'url(#increase-stripes-left)' : 'url(#decrease-stripes-left)')
                .attr('stroke', delta >= 0 ? '#00C805' : '#FF3B60')
                .attr('stroke-opacity', 0.95)
                .attr('stroke-width', 0.5)
                .attr('rx', 1)
            }
          }
        }
      })

      // Spot Line
      if (isRotated) {
        const spotX = strikeScale(endSpotPrice)
        if (spotX >= 0 && spotX <= chartWidth) {
          g.append('line')
            .attr('x1', spotX).attr('x2', spotX)
            .attr('y1', 0).attr('y2', chartHeight)
            .attr('stroke', colors.accent.amber).attr('stroke-width', 1).style('opacity', 0.8)
        }
      } else {
        const spotY = yScale(endSpotPrice)
        if (spotY >= 0 && spotY <= chartHeight) {
          g.append('line')
            .attr('x1', 0).attr('x2', chartWidth)
            .attr('y1', spotY).attr('y2', spotY)
            .attr('stroke', colors.accent.amber).attr('stroke-width', 1).style('opacity', 0.8)
        }
      }

      // GEX Magnet / Gravity Well Line
      if (maxGexStrike > 0) {
        const magnetY = yScale(maxGexStrike)
        const isNegGexMagnet = maxGexVal < 0
        const magnetColor = isNegGexMagnet ? '#ff3366' : '#00ff66'
        
        if (isRotated) {
          const magnetX = strikeScale(maxGexStrike)
          if (magnetX >= 0 && magnetX <= chartWidth) {
            g.append('line')
              .attr('x1', magnetX).attr('x2', magnetX)
              .attr('y1', 0).attr('y2', chartHeight)
              .attr('stroke', magnetColor).attr('stroke-width', 1).attr('stroke-dasharray', '3,3').style('opacity', 0.6)
          }
        } else {
          if (magnetY >= 0 && magnetY <= chartHeight) {
            g.append('line')
              .attr('x1', 0).attr('x2', chartWidth)
              .attr('y1', magnetY).attr('y2', magnetY)
              .attr('stroke', magnetColor).attr('stroke-width', 1).attr('stroke-dasharray', '3,3').style('opacity', 0.6)
          }
        }
      }

      // Gamma Flip / Zero Cross Line (Only relevant in Gamma Mode)
      if (displayMode === 'gamma-vol' && endZeroGamma) {
        if (isRotated) {
          const flipX = strikeScale(endZeroGamma)
          if (flipX >= 0 && flipX <= chartWidth) {
            g.append('line')
              .attr('x1', flipX).attr('x2', flipX)
              .attr('y1', 0).attr('y2', chartHeight)
              .attr('stroke', colors.accent.magenta).attr('stroke-width', 1).attr('stroke-dasharray', '3,3').style('opacity', 0.8)
          }
        } else {
          const flipY = yScale(endZeroGamma)
          if (flipY >= 0 && flipY <= chartHeight) {
            g.append('line')
              .attr('x1', 0).attr('x2', chartWidth)
              .attr('y1', flipY).attr('y2', flipY)
              .attr('stroke', colors.accent.magenta).attr('stroke-width', 1).attr('stroke-dasharray', '3,3').style('opacity', 0.8)
          }
        }
      }

      // Axes
      if (isRotated) {
        // X Axis represents Strike Price
        const xAxis = d3.axisBottom(strikeScale).ticks(5).tickFormat(d => formatCurrency(d as number))
        const xAxisG = g.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis)
        xAxisG.selectAll('line').attr('stroke', 'none')
        xAxisG.selectAll('path').attr('stroke', '#1A1A1A')
        xAxisG.selectAll('text').attr('fill', '#949494').style('font-family', typography.fontSans).style('font-size', '9px').attr('dy', '10px')

        // Y Axis — dynamic M-scale ticks from ticker-aware leftMax
        const nSteps = 4
        const stepSize = leftMax / nSteps
        const yTickVals = Array.from({ length: nSteps * 2 + 1 }, (_, i) =>
          parseFloat(((i - nSteps) * stepSize).toFixed(4))
        )
        const yAxis = d3.axisLeft(exposureScale)
          .tickValues(yTickVals)
          .tickFormat(d => formatAxisM(d as number))
        const yAxisG = g.append('g').call(yAxis)
        yAxisG.selectAll('line').attr('stroke', '#222')
        yAxisG.selectAll('path').attr('stroke', 'none')
        yAxisG.selectAll('text').attr('fill', '#B5B5B5').style('font-family', typography.fontMono).style('font-size', '9px').attr('dx', '-3px')
      } else {
        // X Axis — dynamic M-scale ticks from ticker-aware leftMax
        const nSteps = 4
        const stepSize = leftMax / nSteps
        const xTickVals = Array.from({ length: nSteps * 2 + 1 }, (_, i) =>
          parseFloat(((i - nSteps) * stepSize).toFixed(4))
        )
        const xAxis = d3.axisBottom(xScale)
          .tickValues(xTickVals)
          .tickFormat(d => formatAxisM(d as number))
        const xAxisG = g.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis)
        xAxisG.selectAll('line').attr('stroke', 'none')
        xAxisG.selectAll('path').attr('stroke', '#1A1A1A')
        xAxisG.selectAll('text').attr('fill', '#949494').style('font-family', typography.fontSans).style('font-size', '9px').attr('dy', '10px')
      }

      // Label
      g.append('text')
        .attr('x', chartWidth / 2).attr('y', isRotated ? 12 : chartHeight + 28)
        .attr('text-anchor', 'middle')
        .attr('fill', '#949494').style('font-family', typography.fontSans).style('font-size', '9px')
        .text(displayMode === 'gamma-vol'
          ? (showAbsolute ? 'Absolute GEX (Calls ↑ | ← Puts)' : 'GEX Profile')
          : (showAbsolute ? 'Absolute VEX (Calls ↑ | ← Puts)' : 'Vanna Profile (VEX)'))

      // Hover overlay (tooltips only)
      g.append('rect')
        .attr('width', chartWidth).attr('height', chartHeight)
        .attr('fill', 'transparent')
        .on('mousemove', (event) => {
          const [mx, my] = d3.pointer(event)
          const price = isRotated ? strikeScale.invert(mx) : yScale.invert(my)

          const closest = leftProfileData.reduce((prev, curr) => {
            return Math.abs(curr.strike - price) < Math.abs(prev.strike - price) ? curr : prev
          }, leftProfileData[0])

          if (closest && tooltipRef.current && containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect()
            const isGamma = displayMode === 'gamma-vol'
            const greekLabel = isGamma ? 'GEX' : 'Vanna'
            const symbol = market === 'INDIA' ? '₹' : '$'
            const formattedStrike = `${symbol}${closest.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
            const headerTitle = isGamma
              ? (showAbsolute ? 'GEX Profile (ABS)' : 'GEX Profile (NET)')
              : (showAbsolute ? 'Vanna Profile (ABS)' : 'Vanna Profile (NET)')

            let htmlContent = `
              <div class="flex items-center justify-between border-b border-[#222]/40 pb-1.5 mb-1 flex-row gap-6">
                <span class="text-[10px] font-mono font-bold text-[#E5E5E5] uppercase tracking-wider">${headerTitle}</span>
                <span class="text-[10px] font-mono text-[#00C805] font-bold">Strike ${formattedStrike}</span>
              </div>
            `
            if (showAbsolute) {
              if (isLive) {
                htmlContent += `
                  <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                    <span class="text-[#949494]">Call ${greekLabel}</span>
                    <span class="text-[#00C805] font-bold">${formatBillions(closest.endCallVal)}</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                    <span class="text-[#949494]">Put ${greekLabel}</span>
                    <span class="text-[#FF3B60] font-bold">${formatBillions(Math.abs(closest.endPutVal))}</span>
                  </div>
                `
              } else {
                const deltaCall = closest.endCallVal - closest.startCallVal
                const deltaPut = Math.abs(closest.endPutVal) - Math.abs(closest.startPutVal)
                htmlContent += `
                  <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                    <span class="text-[#949494]">Start Call/Put</span>
                    <span class="text-[#949494]">${formatBillions(closest.startCallVal)} / ${formatBillions(Math.abs(closest.startPutVal))}</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                    <span class="text-[#949494]">End Call/Put</span>
                    <span class="text-[#E5E5E5]">${formatBillions(closest.endCallVal)} / ${formatBillions(Math.abs(closest.endPutVal))}</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] font-mono border-t border-[#222]/20 pt-1.5 mt-0.5 flex-row gap-6">
                    <span class="text-[#949494]">Call Change</span>
                    <span class="font-bold ${deltaCall >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaCall >= 0 ? '+' : ''}${formatBillions(deltaCall)}</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                    <span class="text-[#949494]">Put Change</span>
                    <span class="font-bold ${deltaPut >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaPut >= 0 ? '+' : ''}${formatBillions(deltaPut)}</span>
                  </div>
                `
              }
            } else {
              if (isLive) {
                htmlContent += `
                  <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                    <span class="text-[#949494]">Net ${greekLabel}</span>
                    <span class="font-bold ${closest.endNetVal >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${formatBillions(closest.endNetVal)}</span>
                  </div>
                `
              } else {
                const deltaNet = closest.endNetVal - closest.startNetVal
                htmlContent += `
                  <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                    <span class="text-[#949494]">Start Net ${greekLabel}</span>
                    <span class="text-[#949494]">${formatBillions(closest.startNetVal)}</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                    <span class="text-[#949494]">End Net ${greekLabel}</span>
                    <span class="text-[#E5E5E5] font-bold">${formatBillions(closest.endNetVal)}</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] font-mono border-t border-[#222]/20 pt-1.5 mt-0.5 flex-row gap-6">
                    <span class="text-[#949494]">Change</span>
                    <span class="font-bold ${deltaNet >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaNet >= 0 ? '+' : ''}${formatBillions(deltaNet)}</span>
                  </div>
                `
              }
            }
            tooltipRef.current.innerHTML = htmlContent
            tooltipRef.current.style.opacity = '1'

            const relX = event.clientX - containerRect.left
            const relY = event.clientY - containerRect.top

            // Intelligent edge-detection positioning
            if (relX > containerRect.width - 280) {
              tooltipRef.current.style.left = `${relX - 14}px`
              tooltipRef.current.style.transform = 'translateX(-100%)'
            } else {
              tooltipRef.current.style.left = `${relX + 14}px`
              tooltipRef.current.style.transform = 'none'
            }

            if (relY < 120) {
              tooltipRef.current.style.top = `${relY + 20}px`
            } else if (relY > containerRect.height - 120) {
              tooltipRef.current.style.top = `${relY - 120}px`
            } else {
              tooltipRef.current.style.top = `${relY - 50}px`
            }
          }
        })
        .on('mouseleave', hideCrosshairs)
    }

    // ─── 3. RIGHT PROFILE CHART (Volume/Charm) ───
    if (!isGexOverlayEnabled && volSvg) {
      const currentMargin = isRotated ? marginRotated : margin
      const chartWidth = volWidth - currentMargin.left - currentMargin.right
      const chartHeight = volHeight - currentMargin.top - currentMargin.bottom

      const g = volSvg.append('g').attr('transform', `translate(${currentMargin.left},${currentMargin.top})`)

      const rightProfileData = rightProfileDataCombined.filter(p => p.strike >= yDomain[0] && p.strike <= yDomain[1])

      const isVolMode = displayMode === 'gamma-vol'
      const isSymmetric = displayMode === 'vanna-charm' || showAbsolute

      // Ticker-aware scale for all right-chart modes
      // Volume: 0 → tickerRightMax (contracts)
      // Vanna/Charm: ±tickerRightMax (billion-scale)
      const rightMax = tickerRightMax

      const xScale = d3.scaleLinear()
        .domain(isSymmetric ? [-rightMax, rightMax] : [0, rightMax])
        .range([0, chartWidth])

      const strikeScale = d3.scaleLinear()
        .domain(yDomain)
        .range([0, chartWidth])

      const exposureScale = d3.scaleLinear()
        .domain(isSymmetric ? [-rightMax, rightMax] : [0, rightMax])
        .range([chartHeight, 0])

      // Append definitions for striped patterns
      const defsRight = volSvg.append('defs')

      defsRight.append('pattern')
        .attr('id', 'increase-stripes-right')
        .attr('width', 6)
        .attr('height', 6)
        .attr('patternUnits', 'userSpaceOnUse')
        .call(p => {
          p.append('rect')
            .attr('width', 6)
            .attr('height', 6)
            .attr('fill', 'rgba(0, 200, 5, 0.15)')
          p.append('path')
            .attr('d', 'M-1,1 L1,-1 M0,6 L6,0 M5,7 L7,5')
            .attr('stroke', '#00C805')
            .attr('stroke-width', 1.2)
            .attr('fill', 'none')
        })

      defsRight.append('pattern')
        .attr('id', 'decrease-stripes-right')
        .attr('width', 6)
        .attr('height', 6)
        .attr('patternUnits', 'userSpaceOnUse')
        .call(p => {
          p.append('rect')
            .attr('width', 6)
            .attr('height', 6)
            .attr('fill', 'rgba(255, 59, 96, 0.15)')
          p.append('path')
            .attr('d', 'M-1,1 L1,-1 M0,6 L6,0 M5,7 L7,5')
            .attr('stroke', '#FF3B60')
            .attr('stroke-width', 1.2)
            .attr('fill', 'none')
        })

      if (isSymmetric) {
        // Zero line in the center for Charm
        if (isRotated) {
          g.append('line')
            .attr('x1', 0).attr('x2', chartWidth)
            .attr('y1', exposureScale(0)).attr('y2', exposureScale(0))
            .attr('stroke', '#222').attr('stroke-width', 1)
        } else {
          g.append('line')
            .attr('x1', xScale(0)).attr('x2', xScale(0))
            .attr('y1', 0).attr('y2', chartHeight)
            .attr('stroke', '#222').attr('stroke-width', 1)
        }
      }

      // Use static doubled bar thickness / width to keep it clean and robust
      const dynamicBarThicknessRight = 14
      const dynamicBarWidthRight = 14
      const dynamicBarOffsetRight = 7

      // Draw horizontal or vertical bars
      rightProfileData.forEach(p => {
        if (isRotated) {
          const x = strikeScale(p.strike)
          if (x === undefined || x < 0 || x > chartWidth) return
          const barWidth = dynamicBarWidthRight
          const barX = x - barWidth / 2

          if (showAbsolute) {
            // Absolute Mode for Charm / Volume
            if (!isLive) {
              // Start Call bar
              const startCallHeight = Math.abs(exposureScale(p.startCallVal) - exposureScale(0))
              g.append('rect')
                .attr('x', barX).attr('y', exposureScale(p.startCallVal))
                .attr('width', barWidth).attr('height', Math.max(1, startCallHeight))
                .attr('fill', 'rgba(0, 200, 5, 0.3)')
                .attr('stroke', '#00C805').attr('stroke-opacity', 0.3).attr('stroke-width', 0.5).attr('rx', 1)

              // Start Put bar
              const startPutHeight = Math.abs(exposureScale(p.startPutVal) - exposureScale(0))
              g.append('rect')
                .attr('x', barX).attr('y', exposureScale(0))
                .attr('width', barWidth).attr('height', Math.max(1, startPutHeight))
                .attr('fill', 'rgba(255, 59, 96, 0.3)')
                .attr('stroke', '#FF3B60').attr('stroke-opacity', 0.3).attr('stroke-width', 0.5).attr('rx', 1)
            }

            // End Call bar
            const endCallHeight = Math.abs(exposureScale(p.endCallVal) - exposureScale(0))
            g.append('rect')
              .attr('x', barX).attr('y', exposureScale(p.endCallVal))
              .attr('width', barWidth).attr('height', Math.max(1, endCallHeight))
              .attr('fill', 'rgba(0, 200, 5, 0.65)')
              .attr('stroke', '#00C805').attr('stroke-opacity', 0.65).attr('stroke-width', 0.5).attr('rx', 1)

            // End Put bar
            const endPutHeight = Math.abs(exposureScale(p.endPutVal) - exposureScale(0))
            g.append('rect')
              .attr('x', barX).attr('y', exposureScale(0))
              .attr('width', barWidth).attr('height', Math.max(1, endPutHeight))
              .attr('fill', 'rgba(255, 59, 96, 0.65)')
              .attr('stroke', '#FF3B60').attr('stroke-opacity', 0.65).attr('stroke-width', 0.5).attr('rx', 1)

            if (!isLive) {
              // Delta Call
              const deltaCall = p.endCallVal - p.startCallVal
              if (Math.abs(deltaCall) > 1e-5) {
                const deltaHeight = Math.abs(exposureScale(p.endCallVal) - exposureScale(p.startCallVal))
                const deltaY = exposureScale(Math.max(p.startCallVal, p.endCallVal))
                g.append('rect')
                  .attr('x', barX).attr('y', deltaY)
                  .attr('width', barWidth).attr('height', Math.max(1, deltaHeight))
                  .attr('fill', deltaCall >= 0 ? 'url(#increase-stripes-right)' : 'url(#decrease-stripes-right)')
                  .attr('stroke', deltaCall >= 0 ? '#00C805' : '#FF3B60')
                  .attr('stroke-opacity', 0.95).attr('stroke-width', 0.5).attr('rx', 1)
              }

              // Delta Put
              const deltaPutRaw = Math.abs(p.endPutVal) - Math.abs(p.startPutVal)
              const deltaPutHeight = Math.abs(exposureScale(p.endPutVal) - exposureScale(p.startPutVal))
              const deltaPutY = exposureScale(Math.max(p.startPutVal, p.endPutVal))
              if (Math.abs(deltaPutRaw) > 1e-5) {
                g.append('rect')
                  .attr('x', barX).attr('y', deltaPutY)
                  .attr('width', barWidth).attr('height', Math.max(1, deltaPutHeight))
                  .attr('fill', deltaPutRaw >= 0 ? 'url(#increase-stripes-right)' : 'url(#decrease-stripes-right)')
                  .attr('stroke', deltaPutRaw >= 0 ? '#00C805' : '#FF3B60')
                  .attr('stroke-opacity', 0.95).attr('stroke-width', 0.5).attr('rx', 1)
              }
            }
          } else {
            // Net Mode (Volume or original Charm)
            const startVal = p.startNetVal
            const endVal = p.endNetVal
            const delta = endVal - startVal

            if (!isLive) {
              const startHeight = Math.abs(exposureScale(startVal) - exposureScale(0))
              const startY = Math.min(exposureScale(0), exposureScale(startVal))
              g.append('rect')
                .attr('x', barX).attr('y', startY)
                .attr('width', barWidth).attr('height', Math.max(1, startHeight))
                .attr('fill', isSymmetric
                  ? (startVal >= 0 ? 'rgba(0, 200, 5, 0.3)' : 'rgba(255, 59, 96, 0.3)')
                  : 'rgba(0, 200, 255, 0.3)')
                .attr('stroke', isSymmetric ? (startVal >= 0 ? '#00C805' : '#FF3B60') : '#00C8FF')
                .attr('stroke-opacity', 0.3).attr('stroke-width', 0.5).attr('rx', 1)
            }

            const endHeight = Math.abs(exposureScale(endVal) - exposureScale(0))
            const endY = Math.min(exposureScale(0), exposureScale(endVal))
            g.append('rect')
              .attr('x', barX).attr('y', endY)
              .attr('width', barWidth).attr('height', Math.max(1, endHeight))
              .attr('fill', isSymmetric
                ? (endVal >= 0 ? 'rgba(0, 200, 5, 0.65)' : 'rgba(255, 59, 96, 0.65)')
                : 'rgba(0, 200, 255, 0.65)')
              .attr('stroke', isSymmetric ? (endVal >= 0 ? '#00C805' : '#FF3B60') : '#00C8FF')
              .attr('stroke-opacity', 0.65).attr('stroke-width', 0.5).attr('rx', 1)

            if (!isLive && Math.abs(delta) > 1e-5) {
              const deltaHeight = Math.abs(exposureScale(endVal) - exposureScale(startVal))
              const deltaY = exposureScale(Math.max(startVal, endVal))
              g.append('rect')
                .attr('x', barX).attr('y', deltaY)
                .attr('width', barWidth).attr('height', Math.max(1, deltaHeight))
                .attr('fill', delta >= 0 ? 'url(#increase-stripes-right)' : 'url(#decrease-stripes-right)')
                .attr('stroke', delta >= 0 ? '#00C805' : '#FF3B60')
                .attr('stroke-opacity', 0.95).attr('stroke-width', 0.5).attr('rx', 1)
            }
          }
        } else {
          // Normal mode (horizontal bars)
          const y = yScale(p.strike)
          if (y === undefined || y < 0 || y > chartHeight) return

          if (showAbsolute) {
            // Absolute Mode for Charm / Volume
            if (!isLive) {
              // Start Call bar
              const startCallWidth = Math.abs(xScale(p.startCallVal) - xScale(0))
              g.append('rect')
                .attr('x', xScale(0)).attr('y', y - dynamicBarOffsetRight)
                .attr('width', Math.max(1, startCallWidth))
                .attr('height', dynamicBarThicknessRight)
                .attr('fill', 'rgba(0, 200, 5, 0.3)')
                .attr('stroke', '#00C805')
                .attr('stroke-opacity', 0.3)
                .attr('stroke-width', 0.5)
                .attr('rx', 1)

              // Start Put bar
              const startPutWidth = Math.abs(xScale(p.startPutVal) - xScale(0))
              g.append('rect')
                .attr('x', xScale(p.startPutVal)).attr('y', y - dynamicBarOffsetRight)
                .attr('width', Math.max(1, startPutWidth))
                .attr('height', dynamicBarThicknessRight)
                .attr('fill', 'rgba(255, 59, 96, 0.3)')
                .attr('stroke', '#FF3B60')
                .attr('stroke-opacity', 0.3)
                .attr('stroke-width', 0.5)
                .attr('rx', 1)
            }

            // End Call bar
            const endCallWidth = Math.abs(xScale(p.endCallVal) - xScale(0))
            g.append('rect')
              .attr('x', xScale(0)).attr('y', y - dynamicBarOffsetRight)
              .attr('width', Math.max(1, endCallWidth))
              .attr('height', dynamicBarThicknessRight)
              .attr('fill', 'rgba(0, 200, 5, 0.65)')
              .attr('stroke', '#00C805')
              .attr('stroke-opacity', 0.65)
              .attr('stroke-width', 0.5)
              .attr('rx', 1)

            // End Put bar
            const endPutWidth = Math.abs(xScale(p.endPutVal) - xScale(0))
            g.append('rect')
              .attr('x', xScale(p.endPutVal)).attr('y', y - dynamicBarOffsetRight)
              .attr('width', Math.max(1, endPutWidth))
              .attr('height', dynamicBarThicknessRight)
              .attr('fill', 'rgba(255, 59, 96, 0.65)')
              .attr('stroke', '#FF3B60')
              .attr('stroke-opacity', 0.65)
              .attr('stroke-width', 0.5)
              .attr('rx', 1)

            if (!isLive) {
              // Delta Call
              const deltaCall = p.endCallVal - p.startCallVal
              if (Math.abs(deltaCall) > 1e-5) {
                const deltaWidth = Math.abs(xScale(p.endCallVal) - xScale(p.startCallVal))
                const deltaX = xScale(Math.min(p.startCallVal, p.endCallVal))
                g.append('rect')
                  .attr('x', deltaX).attr('y', y - dynamicBarOffsetRight)
                  .attr('width', Math.max(1, deltaWidth))
                  .attr('height', dynamicBarThicknessRight)
                  .attr('fill', deltaCall >= 0 ? 'url(#increase-stripes-right)' : 'url(#decrease-stripes-right)')
                  .attr('stroke', deltaCall >= 0 ? '#00C805' : '#FF3B60')
                  .attr('stroke-opacity', 0.95)
                  .attr('stroke-width', 0.5)
                  .attr('rx', 1)
              }

              // Delta Put
              const deltaPutRaw = Math.abs(p.endPutVal) - Math.abs(p.startPutVal)
              const deltaPutWidth = Math.abs(xScale(p.endPutVal) - xScale(p.startPutVal))
              const deltaPutX = xScale(Math.min(p.startPutVal, p.endPutVal))
              if (Math.abs(deltaPutRaw) > 1e-5) {
                g.append('rect')
                  .attr('x', deltaPutX).attr('y', y - dynamicBarOffsetRight)
                  .attr('width', Math.max(1, deltaPutWidth))
                  .attr('height', dynamicBarThicknessRight)
                  .attr('fill', deltaPutRaw >= 0 ? 'url(#increase-stripes-right)' : 'url(#decrease-stripes-right)')
                  .attr('stroke', deltaPutRaw >= 0 ? '#00C805' : '#FF3B60')
                  .attr('stroke-opacity', 0.95)
                  .attr('stroke-width', 0.5)
                  .attr('rx', 1)
              }
            }
          } else {
            // Net Mode (Volume or original Charm)
            const startVal = p.startNetVal
            const endVal = p.endNetVal
            const delta = endVal - startVal

            if (!isLive) {
              const startWidth = Math.abs(xScale(startVal) - xScale(0))
              const startX = isSymmetric ? (startVal >= 0 ? xScale(0) : xScale(startVal)) : xScale(0)
              g.append('rect')
                .attr('x', startX).attr('y', y - dynamicBarOffsetRight)
                .attr('width', Math.max(1, startWidth))
                .attr('height', dynamicBarThicknessRight)
                .attr('fill', isSymmetric
                  ? (startVal >= 0 ? 'rgba(0, 200, 5, 0.3)' : 'rgba(255, 59, 96, 0.3)')
                  : 'rgba(0, 200, 255, 0.3)')
                .attr('stroke', isSymmetric ? (startVal >= 0 ? '#00C805' : '#FF3B60') : '#00C8FF')
                .attr('stroke-opacity', 0.3)
                .attr('stroke-width', 0.5)
                .attr('rx', 1)
            }

            const endWidth = Math.abs(xScale(endVal) - xScale(0))
            const endX = isSymmetric ? (endVal >= 0 ? xScale(0) : xScale(endVal)) : xScale(0)
            g.append('rect')
              .attr('x', endX).attr('y', y - dynamicBarOffsetRight)
              .attr('width', Math.max(1, endWidth))
              .attr('height', dynamicBarThicknessRight)
              .attr('fill', isSymmetric
                ? (endVal >= 0 ? 'rgba(0, 200, 5, 0.65)' : 'rgba(255, 59, 96, 0.65)')
                : 'rgba(0, 200, 255, 0.65)')
              .attr('stroke', isSymmetric ? (endVal >= 0 ? '#00C805' : '#FF3B60') : '#00C8FF')
              .attr('stroke-opacity', 0.65)
              .attr('stroke-width', 0.5)
              .attr('rx', 1)

            if (!isLive && Math.abs(delta) > 1e-5) {
              const deltaWidth = Math.abs(xScale(endVal) - xScale(startVal))
              const deltaX = xScale(Math.min(startVal, endVal))
              g.append('rect')
                .attr('x', deltaX).attr('y', y - dynamicBarOffsetRight)
                .attr('width', Math.max(1, deltaWidth))
                .attr('height', dynamicBarThicknessRight)
                .attr('fill', delta >= 0 ? 'url(#increase-stripes-right)' : 'url(#decrease-stripes-right)')
                .attr('stroke', delta >= 0 ? '#00C805' : '#FF3B60')
                .attr('stroke-opacity', 0.95)
                .attr('stroke-width', 0.5)
                .attr('rx', 1)
            }
          }
        }
      })

      // Spot Line
      if (isRotated) {
        const spotX = strikeScale(endSpotPrice)
        if (spotX >= 0 && spotX <= chartWidth) {
          g.append('line')
            .attr('x1', spotX).attr('x2', spotX)
            .attr('y1', 0).attr('y2', chartHeight)
            .attr('stroke', colors.accent.amber).attr('stroke-width', 1).style('opacity', 0.8)
        }
      } else {
        const spotY = yScale(endSpotPrice)
        if (spotY >= 0 && spotY <= chartHeight) {
          g.append('line')
            .attr('x1', 0).attr('x2', chartWidth)
            .attr('y1', spotY).attr('y2', spotY)
            .attr('stroke', colors.accent.amber).attr('stroke-width', 1).style('opacity', 0.8)
        }
      }

      // GEX Magnet / Gravity Well Line
      if (maxGexStrike > 0) {
        const magnetY = yScale(maxGexStrike)
        const isNegGexMagnet = maxGexVal < 0
        const magnetColor = isNegGexMagnet ? '#ff3366' : '#00ff66'
        
        if (isRotated) {
          const magnetX = strikeScale(maxGexStrike)
          if (magnetX >= 0 && magnetX <= chartWidth) {
            g.append('line')
              .attr('x1', magnetX).attr('x2', magnetX)
              .attr('y1', 0).attr('y2', chartHeight)
              .attr('stroke', magnetColor).attr('stroke-width', 1).attr('stroke-dasharray', '3,3').style('opacity', 0.6)
          }
        } else {
          if (magnetY >= 0 && magnetY <= chartHeight) {
            g.append('line')
              .attr('x1', 0).attr('x2', chartWidth)
              .attr('y1', magnetY).attr('y2', magnetY)
              .attr('stroke', magnetColor).attr('stroke-width', 1).attr('stroke-dasharray', '3,3').style('opacity', 0.6)
          }
        }
      }

      // Axes
      if (isRotated) {
        // X Axis represents Strike Price
        const xAxis = d3.axisBottom(strikeScale).ticks(5).tickFormat(d => formatCurrency(d as number))
        const xAxisG = g.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis)
        xAxisG.selectAll('line').attr('stroke', 'none')
        xAxisG.selectAll('path').attr('stroke', '#1A1A1A')
        xAxisG.selectAll('text').attr('fill', '#949494').style('font-family', typography.fontSans).style('font-size', '9px').attr('dy', '10px')

        // Y Axis represents Exposure — ticker-aware ticks
        const yAxis = (() => {
          if (isSymmetric) {
            // Charm/Vanna: ±M scale ticks evenly spaced up to rightMax
            const nSteps = 4
            const stepSize = rightMax / nSteps
            const tickVals = Array.from({ length: nSteps * 2 + 1 }, (_, i) =>
              parseFloat(((i - nSteps) * stepSize).toFixed(4))
            )
            return d3.axisLeft(exposureScale)
              .tickValues(tickVals)
              .tickFormat(d => formatAxisM(d as number))
          }
          // Volume mode: compact contract counts
          return d3.axisLeft(exposureScale).ticks(4).tickFormat(d => formatCompact(d as number))
        })()
        const yAxisG = g.append('g').call(yAxis)
        yAxisG.selectAll('line').attr('stroke', '#222')
        yAxisG.selectAll('path').attr('stroke', 'none')
        yAxisG.selectAll('text').attr('fill', '#B5B5B5').style('font-family', typography.fontMono).style('font-size', '9px').attr('dx', '-3px')
      } else {
        // X Axis represents Exposure — ticker-aware ticks
        const xAxis = (() => {
          if (isSymmetric) {
            const nSteps = 4
            const stepSize = rightMax / nSteps
            const tickVals = Array.from({ length: nSteps * 2 + 1 }, (_, i) =>
              parseFloat(((i - nSteps) * stepSize).toFixed(4))
            )
            return d3.axisBottom(xScale)
              .tickValues(tickVals)
              .tickFormat(d => formatAxisM(d as number))
          }
          return d3.axisBottom(xScale).ticks(4).tickFormat(d => formatCompact(d as number))
        })()
        const xAxisG = g.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis)
        xAxisG.selectAll('line').attr('stroke', 'none')
        xAxisG.selectAll('path').attr('stroke', '#1A1A1A')
        xAxisG.selectAll('text').attr('fill', '#949494').style('font-family', typography.fontSans).style('font-size', '9px').attr('dy', '10px')
      }

      // Label
      g.append('text')
        .attr('x', chartWidth / 2).attr('y', isRotated ? 12 : chartHeight + 28)
        .attr('text-anchor', 'middle')
        .attr('fill', '#949494').style('font-family', typography.fontSans).style('font-size', '9px')
        .text(displayMode === 'gamma-vol'
          ? 'Volume Profile'
          : (showAbsolute ? 'Absolute Charm (Calls → | ← Puts)' : 'Charm Profile (CEX)'))

      // Hover overlay
      g.append('rect')
        .attr('width', chartWidth).attr('height', chartHeight)
        .attr('fill', 'transparent')
        .on('mousemove', (event) => {
          const [mx, my] = d3.pointer(event)
          const price = isRotated ? strikeScale.invert(mx) : yScale.invert(my)

          const closest = rightProfileData.reduce((prev, curr) => {
            return Math.abs(curr.strike - price) < Math.abs(prev.strike - price) ? curr : prev
          }, rightProfileData[0])

          if (closest && tooltipRef.current && containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect()
            const isVolMode = displayMode === 'gamma-vol'
            const symbol = market === 'INDIA' ? '₹' : '$'
            const formattedStrike = `${symbol}${closest.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
            const headerTitle = isVolMode
              ? 'Volume Profile'
              : (showAbsolute ? 'Charm Profile (ABS)' : 'Charm Profile (NET)')

            let htmlContent = `
              <div class="flex items-center justify-between border-b border-[#222]/40 pb-1.5 mb-1 flex-row gap-6">
                <span class="text-[10px] font-mono font-bold text-[#E5E5E5] uppercase tracking-wider">${headerTitle}</span>
                <span class="text-[10px] font-mono text-[#00C805] font-bold">Strike ${formattedStrike}</span>
              </div>
            `
            if (isVolMode) {
              const startText = closest.startNetVal.toLocaleString() + ' contracts'
              const endText = closest.endNetVal.toLocaleString() + ' contracts'
              const deltaVal = closest.endNetVal - closest.startNetVal
              const deltaText = (deltaVal >= 0 ? '+' : '') + deltaVal.toLocaleString() + ' contracts'

              if (isLive) {
                htmlContent += `
                  <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                    <span class="text-[#949494]">Volume</span>
                    <span class="text-[#00C8FF] font-bold">${endText}</span>
                  </div>
                `
              } else {
                htmlContent += `
                  <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                    <span class="text-[#949494]">Start Volume</span>
                    <span class="text-[#949494]">${startText}</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                    <span class="text-[#949494]">End Volume</span>
                    <span class="text-[#E5E5E5] font-bold">${endText}</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] font-mono border-t border-[#222]/20 pt-1.5 mt-0.5 flex-row gap-6">
                    <span class="text-[#949494]">Change</span>
                    <span class="font-bold ${deltaVal >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaText}</span>
                  </div>
                `
              }
            } else {
              // Charm Mode
              if (showAbsolute) {
                if (isLive) {
                  htmlContent += `
                    <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                      <span class="text-[#949494]">Call Charm</span>
                      <span class="text-[#00C805] font-bold">${formatBillions(closest.endCallVal)}</span>
                    </div>
                    <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                      <span class="text-[#949494]">Put Charm</span>
                      <span class="text-[#FF3B60] font-bold">${formatBillions(Math.abs(closest.endPutVal))}</span>
                    </div>
                  `
                } else {
                  const deltaCall = closest.endCallVal - closest.startCallVal
                  const deltaPut = Math.abs(closest.endPutVal) - Math.abs(closest.startPutVal)
                  htmlContent += `
                    <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                      <span class="text-[#949494]">Start Call/Put</span>
                      <span class="text-[#949494]">${formatBillions(closest.startCallVal)} / ${formatBillions(Math.abs(closest.startPutVal))}</span>
                    </div>
                    <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                      <span class="text-[#949494]">End Call/Put</span>
                      <span class="text-[#E5E5E5]">${formatBillions(closest.endCallVal)} / ${formatBillions(Math.abs(closest.endPutVal))}</span>
                    </div>
                    <div class="flex items-center justify-between text-[10px] font-mono border-t border-[#222]/20 pt-1.5 mt-0.5 flex-row gap-6">
                      <span class="text-[#949494]">Call Change</span>
                      <span class="font-bold ${deltaCall >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaCall >= 0 ? '+' : ''}${formatBillions(deltaCall)}</span>
                    </div>
                    <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                      <span class="text-[#949494]">Put Change</span>
                      <span class="font-bold ${deltaPut >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaPut >= 0 ? '+' : ''}${formatBillions(deltaPut)}</span>
                    </div>
                  `
                }
              } else {
                if (isLive) {
                  htmlContent += `
                    <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                      <span class="text-[#949494]">Net Charm</span>
                      <span class="font-bold ${closest.endNetVal >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${formatBillions(closest.endNetVal)}</span>
                    </div>
                  `
                } else {
                  const deltaNet = closest.endNetVal - closest.startNetVal
                  htmlContent += `
                    <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6 mt-1">
                      <span class="text-[#949494]">Start Net Charm</span>
                      <span class="text-[#949494]">${formatBillions(closest.startNetVal)}</span>
                    </div>
                    <div class="flex items-center justify-between text-[10px] font-mono flex-row gap-6">
                      <span class="text-[#949494]">End Net Charm</span>
                      <span class="text-[#E5E5E5] font-bold">${formatBillions(closest.endNetVal)}</span>
                    </div>
                    <div class="flex items-center justify-between text-[10px] font-mono border-t border-[#222]/20 pt-1.5 mt-0.5 flex-row gap-6">
                      <span class="text-[#949494]">Change</span>
                      <span class="font-bold ${deltaNet >= 0 ? 'text-[#00C805]' : 'text-[#FF3B60]'}">${deltaNet >= 0 ? '+' : ''}${formatBillions(deltaNet)}</span>
                    </div>
                  `
                }
              }
            }
            tooltipRef.current.innerHTML = htmlContent
            tooltipRef.current.style.opacity = '1'

            const relX = event.clientX - containerRect.left
            const relY = event.clientY - containerRect.top

            // Intelligent edge-detection positioning
            if (relX > containerRect.width - 280) {
              tooltipRef.current.style.left = `${relX - 14}px`
              tooltipRef.current.style.transform = 'translateX(-100%)'
            } else {
              tooltipRef.current.style.left = `${relX + 14}px`
              tooltipRef.current.style.transform = 'none'
            }

            if (relY < 120) {
              tooltipRef.current.style.top = `${relY + 20}px`
            } else if (relY > containerRect.height - 120) {
              tooltipRef.current.style.top = `${relY - 120}px`
            } else {
              tooltipRef.current.style.top = `${relY - 50}px`
            }
          }
        })
        .on('mouseleave', hideCrosshairs)
    }

  }, [dimensions, yDomain, visibleCandlesData, indicatorData, startGexProfile, endGexProfile, startVolProfile, endVolProfile, startVannaProfile, endVannaProfile, startCharmProfile, endCharmProfile, endSpotPrice, endZeroGamma, market, ticker, displayMode, isCandlesCollapsed, isLive, showAbsolute, isRotated, tickerGexMax, tickerRightMax, isGexOverlayEnabled, walls, wallTouchProbabilities])

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
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all font-bold ${active
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

        {availableExpiries && selectedExpiries && onSelectedExpiriesChange && onExpiryModeChange && (
          <>
            {/* Column divider line */}
            <div className="w-[1px] h-3.5 bg-[#222] mx-1" />

            {/* Expiry Selector Popover */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="px-2 py-0.5 rounded text-[10px] font-mono transition-all font-bold bg-transparent text-[#777] border border-transparent hover:text-white flex items-center gap-1"
                  title="Select Expirations"
                  type="button"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>EXP: {expiryMode.toUpperCase()}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0 bg-black border border-[#222] z-50" container={containerRef.current}>
                <ExpirySelector
                  availableExpiries={availableExpiries}
                  mode={expiryMode as any}
                  onModeChange={onExpiryModeChange as any}
                  selectedExpiries={selectedExpiries}
                  onSelectedExpiriesChange={onSelectedExpiriesChange}
                  optionData={endOptionData}
                />
              </PopoverContent>
            </Popover>
          </>
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

        {/* Column divider line */}
        <div className="w-[1px] h-3.5 bg-[#222] mx-1" />

        {/* Rotate Toggle Button */}
        <button
          onClick={() => setIsRotated(!isRotated)}
          className={`p-0.5 rounded hover:bg-[#111] transition-colors flex items-center justify-center ${isRotated ? 'text-terminal-green' : 'text-[#777] hover:text-white'
            }`}
          title={isRotated ? "Show Standard Layout" : "Rotate Axes (Strikes on X)"}
          type="button"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>

        {/* Column divider line */}
        <div className="w-[1px] h-3.5 bg-[#222] mx-1" />

        {/* GEX Overlay Full Screen Toggle Button */}
        <button
          onClick={toggleFullscreen}
          className={`p-0.5 rounded hover:bg-[#111] transition-colors flex items-center justify-center ${isGexOverlayEnabled ? 'text-terminal-green' : 'text-[#777] hover:text-white'
            }`}
          title={isGexOverlayEnabled ? "Exit Overlay Full Screen" : "Enter GEX Overlay (Full Screen)"}
          type="button"
        >
          <Layers className="w-3.5 h-3.5" />
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

        {/* Absolute vs Net Toggle */}
        <div className="flex items-center gap-1 bg-black/70 backdrop-blur-md px-1 py-1 rounded border border-[#222]">
          <button
            onClick={() => setShowAbsolute(false)}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all font-bold ${!showAbsolute
              ? 'bg-terminal-green/15 text-terminal-green border border-terminal-green/30'
              : 'bg-transparent text-[#777] border border-transparent hover:text-white'
              }`}
            type="button"
          >
            NET
          </button>
          <button
            onClick={() => setShowAbsolute(true)}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all font-bold ${showAbsolute
              ? 'bg-terminal-green/15 text-terminal-green border border-terminal-green/30'
              : 'bg-transparent text-[#777] border border-transparent hover:text-white'
              }`}
            type="button"
          >
            ABS
          </button>
        </div>

        {/* Mode Toggle pills */}
        <div className="flex items-center gap-1 bg-black/70 backdrop-blur-md px-1 py-1 rounded border border-[#222]">
          <button
            onClick={() => setDisplayMode('gamma-vol')}
            className={`px-2.5 py-0.5 rounded text-[10px] font-mono transition-all font-bold ${displayMode === 'gamma-vol'
              ? 'bg-terminal-green/15 text-terminal-green border border-terminal-green/30'
              : 'bg-transparent text-[#777] border border-transparent hover:text-white'
              }`}
            type="button"
          >
            GAMMA / VOL
          </button>
          <button
            onClick={() => setDisplayMode('vanna-charm')}
            className={`px-2.5 py-0.5 rounded text-[10px] font-mono transition-all font-bold ${displayMode === 'vanna-charm'
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
      <div className="h-full relative flex-shrink-0" style={{ width: isGexOverlayEnabled ? '100%' : (isCandlesCollapsed ? '75px' : `${dimensions.width * 0.5}px`) }}>
        <svg
          ref={candleSvgRef}
          className={`h-full w-full ${isCandlesCollapsed ? 'cursor-ns-resize' : 'cursor-crosshair'}`}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        />
        {candles.length === 0 && !loadingHistory && !isCandlesCollapsed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10 pointer-events-none border-r border-[#141416]">
            <span className="text-xs font-mono text-[#555] uppercase tracking-wider text-center px-4">No historical price data available</span>
          </div>
        )}
      </div>

      {!isGexOverlayEnabled && (
        isRotated ? (
          <div className="flex-1 flex flex-col min-w-0 h-full border-l border-[#15151A]">
            <svg
              ref={gexSvgRef}
              className="w-full h-1/2 cursor-grab active:cursor-grabbing border-b border-[#15151A]"
              onMouseDown={handleProfileMouseDown}
              onDoubleClick={handleProfileDoubleClick}
            />
            <svg
              ref={volSvgRef}
              className="w-full h-1/2 cursor-grab active:cursor-grabbing"
              onMouseDown={handleProfileMouseDown}
              onDoubleClick={handleProfileDoubleClick}
            />
          </div>
        ) : (
          <>
            {/* GEX/VEX Profile SVG */}
            <svg
              ref={gexSvgRef}
              className="h-full cursor-grab active:cursor-grabbing border-l border-[#15151A]"
              onMouseDown={handleProfileMouseDown}
              onDoubleClick={handleProfileDoubleClick}
            />

            {/* Volume/CEX Profile SVG */}
            <svg
              ref={volSvgRef}
              className="h-full cursor-grab active:cursor-grabbing border-l border-[#15151A]"
              onMouseDown={handleProfileMouseDown}
              onDoubleClick={handleProfileDoubleClick}
            />
          </>
        )
      )}

      {/* Sync Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none opacity-0 bg-[#070709]/95 border border-[#141416]/90 rounded p-3 flex flex-col gap-2 shadow-2xl z-30 min-w-[260px] transition-opacity duration-100 text-[#D4D4D8]"
        style={{ width: "max-content" }}
      />
    </div>
  )
}
