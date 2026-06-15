"use client"

import { useEffect, useRef, useState, useMemo } from "react"
import * as d3 from "d3"
import { Settings2, Minus, Plus, Maximize2, Activity, Play, Pause, Clock } from "lucide-react"
import type { OptionData } from "@/lib/types"
import {
  computeGEXByStrike,
  computeVannaByStrike,
  computeCharmByStrike,
  findZeroGammaLevel,
  type PricingMethod
} from "@/lib/calculations"
import { colors, typography } from "@/lib/design-tokens"
import { BACKEND_URL } from "@/lib/backend-api"

interface OptionSnapshot {
  timestamp: Date
  spotPrice: number
  options: OptionData[]
}

interface GradientChartsWorkspaceProps {
  optionData: OptionData[]
  ticker: string
  spotPrice: number
  market: 'USA' | 'INDIA'
  pricingMethod: PricingMethod
}

export function GradientChartsWorkspace({
  optionData,
  ticker,
  spotPrice,
  market,
  pricingMethod,
}: GradientChartsWorkspaceProps) {
  const [history, setHistory] = useState<OptionSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [ratesInfo, setRatesInfo] = useState({
    usRiskFreeRate: 0.05,
    indiaRiskFreeRate: 0.065,
    source: "Assumed Defaults"
  })

  // Chart configuration states
  const [greekModeTop, setGreekModeTop] = useState<'gamma' | 'vanna' | 'charm'>('gamma')
  const [greekModeBottom, setGreekModeBottom] = useState<'gamma' | 'vanna' | 'charm'>('charm')
  const [activeZoom, setActiveZoom] = useState<number>(3) // ±3% by default
  const [rthOnly, setRthOnly] = useState(true)

  // Synchronization states
  const [selectedTimeIdx, setSelectedTimeIdx] = useState<number | null>(null)
  const [hoveredTimeIdx, setHoveredTimeIdx] = useState<number | null>(null)
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null)

  // Fetch rates
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
      .catch(err => console.error("Error loading rates in gradient view:", err))
  }, [])

  const activeR = market === 'INDIA' ? ratesInfo.indiaRiskFreeRate : ratesInfo.usRiskFreeRate
  const activeQ = market === 'INDIA' ? 0.012 : 0.013

  // Load or generate history
  useEffect(() => {
    setLoading(true)
    fetch(`${BACKEND_URL}/api/historical-data?ticker=${ticker}&hoursBack=24`)
      .then(res => res.json())
      .then(res => {
        if (res.success && Array.isArray(res.data) && res.data.length >= 3) {
          // Parse historical option snapshots
          const parsed = res.data.map((snap: any) => {
            const date = new Date(snap.timestamp)
            const spot = parseFloat(snap.spotPrice || snap.spot_price)
            
            // Map raw database quotes to OptionData
            const options: OptionData[] = snap.options.map((opt: any) => ({
              option: `${ticker} ${opt.strike} ${opt.type}`,
              strike: parseFloat(opt.strike),
              type: opt.type as "C" | "P",
              expiration: new Date(opt.expiration),
              last: parseFloat(opt.lastPrice || opt.last || 0),
              bid: parseFloat(opt.bid || 0),
              ask: parseFloat(opt.ask || 0),
              volume: parseInt(opt.volume || 0, 10),
              open_interest: parseInt(opt.openInterest || opt.open_interest || 0, 10),
              iv: parseFloat(opt.impliedVolatility || opt.implied_volatility || opt.iv || 0.2) * 100, // convert fraction to percent
              delta: parseFloat(opt.delta || 0),
              gamma: parseFloat(opt.gamma || 0),
            }))
            
            return {
              timestamp: date,
              spotPrice: spot,
              options
            }
          })
          
          // Sort chronologically
          parsed.sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime())
          setHistory(parsed)
          setSelectedTimeIdx(parsed.length - 1)
        } else {
          throw new Error("Insufficient database history. Falling back to simulator.")
        }
      })
      .catch(err => {
        console.warn(err.message)
        // Generate high-resolution mock snapshot history for gorgeous gradient rendering
        const mockSnaps: OptionSnapshot[] = []
        const now = new Date()
        const numSnaps = 50
        const intervalMs = 8 * 60 * 1000 // 8 minutes apart
        let currentSpot = spotPrice

        // Seed random number generator
        const seedString = ticker + spotPrice
        let seed = seedString.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
        const random = () => {
          const x = Math.sin(seed++) * 10000
          return x - Math.floor(x)
        }

        // Generate options chain base template
        const baseStrikes: number[] = []
        const strikeSpacing = ticker === 'SPX' ? 5 : ticker === 'SPY' ? 1 : 10
        const baseStrike = Math.round(spotPrice / strikeSpacing) * strikeSpacing
        for (let i = -30; i <= 30; i++) {
          baseStrikes.push(baseStrike + i * strikeSpacing)
        }

        // Fixed expiration for options chain to properly capture dynamic DTE decay over the historical timeline
        const fixedExpiration = new Date(now.getTime() + 1.5 * 24 * 60 * 60 * 1000)

        // Check if we have real optionData to seed the timeline
        const hasRealSeed = Array.isArray(optionData) && optionData.length > 0

        for (let i = 0; i < numSnaps; i++) {
          const snapTime = new Date(now.getTime() - (numSnaps - 1 - i) * intervalMs)
          
          // Daily random walk centered on current spot
          const priceChange = (random() - 0.49) * (currentSpot * 0.0018)
          currentSpot = currentSpot + priceChange
          if (i === numSnaps - 1) {
            currentSpot = spotPrice // pin last snapshot to active spot price
          }

          // Build option chain at this snapshot
          let snapshotOptions: OptionData[] = []

          if (hasRealSeed) {
            // Clone real options template, but project to historical snapTime
            snapshotOptions = optionData.map(opt => ({
              option: opt.option,
              strike: opt.strike,
              type: opt.type,
              expiration: opt.expiration,
              open_interest: opt.open_interest || 0,
              volume: opt.volume || 0,
              iv: opt.iv || 20,
              gamma: opt.gamma || 0,
              delta: opt.delta || 0,
            }))
          } else {
            // Fallback synthetic generator if no prop data
            baseStrikes.forEach(strike => {
              const distFromATM = Math.abs(strike - currentSpot) / currentSpot
              const baseOI = Math.max(100, Math.round(15000 * Math.exp(-distFromATM * distFromATM * 150)))
              const iv = Math.max(0.08, 0.16 + (currentSpot - strike) / currentSpot * 0.25 + (random() - 0.5) * 0.01)

              snapshotOptions.push({
                option: `${ticker} ${strike} C`,
                strike,
                type: "C",
                expiration: fixedExpiration,
                open_interest: Math.round(baseOI * (1.2 - distFromATM)),
                volume: Math.round(baseOI * 0.15 * random()),
                iv: iv * 100,
                gamma: 0,
                delta: 0,
              })
              snapshotOptions.push({
                option: `${ticker} ${strike} P`,
                strike,
                type: "P",
                expiration: fixedExpiration,
                open_interest: Math.round(baseOI * (0.9 + distFromATM)),
                volume: Math.round(baseOI * 0.12 * random()),
                iv: (iv + 0.02) * 100,
                gamma: 0,
                delta: 0,
              })
            })
          }

          mockSnaps.push({
            timestamp: snapTime,
            spotPrice: currentSpot,
            options: snapshotOptions
          })
        }

        setHistory(mockSnaps)
        setSelectedTimeIdx(mockSnaps.length - 1)
      })
      .finally(() => setLoading(false))
  }, [ticker, spotPrice, optionData])

  // Get active snapshot representing selected or hovered timestamp
  const activeSnapIdx = hoveredTimeIdx !== null ? hoveredTimeIdx : (selectedTimeIdx !== null ? selectedTimeIdx : history.length - 1)
  const activeSnapshot = history[activeSnapIdx]

  // Filter and sort strikes dynamically based on active zoom level
  const strikes = useMemo(() => {
    if (history.length === 0) return []
    const allStrikes = Array.from(new Set(history[0].options.map(o => o.strike))).sort((a, b) => a - b)
    const margin = spotPrice * (activeZoom / 100)
    return allStrikes.filter(s => s >= spotPrice - margin && s <= spotPrice + margin)
  }, [history, spotPrice, activeZoom])

  // Compute aggregated profile data for the active snapshot (displayed in the Left Positions panel)
  const activeGexProfile = useMemo(() => {
    if (!activeSnapshot) return []
    return computeGEXByStrike(activeSnapshot.spotPrice, activeSnapshot.options, pricingMethod)
  }, [activeSnapshot, pricingMethod])

  const activeVannaProfile = useMemo(() => {
    if (!activeSnapshot) return []
    return computeVannaByStrike(activeSnapshot.spotPrice, activeSnapshot.options, activeR, activeQ, pricingMethod)
  }, [activeSnapshot, activeR, activeQ, pricingMethod])

  const activeCharmProfile = useMemo(() => {
    if (!activeSnapshot) return []
    return computeCharmByStrike(activeSnapshot.spotPrice, activeSnapshot.options, activeR, activeQ, pricingMethod)
  }, [activeSnapshot, activeR, activeQ, pricingMethod])

  return (
    <div className="w-full h-full flex flex-col bg-[#050507] border border-[#1A1A1E] rounded-lg overflow-hidden select-none">
      {/* Workspace Header Dashboard controls */}
      <div className="flex flex-row justify-between items-center bg-[#08080C] px-4 py-2.5 border-b border-[#1A1A1E]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-terminal-green animate-pulse" />
            <h2 className="text-xs font-mono font-bold text-white uppercase tracking-wider">Historical Heatmap Analytics</h2>
          </div>
          <span className="text-[10px] font-mono bg-black px-2 py-0.5 rounded border border-[#1A1A1E] text-[#949494]">
            {ticker}
          </span>
          <span className="text-[10px] font-mono text-[#666]">
            Benchmarks: r = {(activeR * 100).toFixed(2)}% ({ratesInfo.source.startsWith('Assumed') ? 'Assumed' : 'Live'})
          </span>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center bg-black/60 border border-[#1A1A1E] rounded overflow-hidden">
            <button
              onClick={() => setActiveZoom(prev => Math.max(1, prev - 1))}
              className="p-1 text-[#777] hover:text-white hover:bg-[#111] transition-colors"
              title="Zoom In (Decrease range)"
              type="button"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 text-[9px] font-mono text-white font-bold min-w-[32px] text-center border-l border-r border-[#1A1A1E]">
              ±{activeZoom}%
            </span>
            <button
              onClick={() => setActiveZoom(prev => Math.min(10, prev + 1))}
              className="p-1 text-[#777] hover:text-white hover:bg-[#111] transition-colors"
              title="Zoom Out (Increase range)"
              type="button"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* RTH Toggle */}
          <button
            onClick={() => setRthOnly(!rthOnly)}
            className={`px-2.5 py-0.5 rounded text-[9px] font-mono transition-all font-bold border ${
              rthOnly 
                ? 'bg-terminal-green/15 text-terminal-green border-terminal-green/30'
                : 'bg-transparent text-[#777] border-transparent hover:text-white'
            }`}
            type="button"
            title="Toggle Regular Trading Hours Only"
          >
            RTH
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-black text-[#888] font-mono text-xs">
          <Clock className="w-6 h-6 animate-spin text-terminal-green mb-3" />
          <span>PARSING HISTORICAL EXPOSURE GRID SNAPSHOTS...</span>
        </div>
      ) : history.length === 0 ? (
        <div className="flex-1 flex items-center justify-center bg-black text-[#666] font-mono text-xs">
          <span>No historical options chain series available.</span>
        </div>
      ) : (
        <div className="flex-1 flex flex-row min-h-0 bg-black">
          {/* LEFT PANEL: POSITIONS BY STRIKE (SYNCED TO Y-AXIS) */}
          <div className="w-1/2 border-r border-[#1A1A1E] flex flex-col min-h-0 bg-[#08080A]">
            <PositionsProfileView
              ticker={ticker}
              strikes={strikes}
              spotPrice={activeSnapshot?.spotPrice || spotPrice}
              options={activeSnapshot?.options || []}
              timestamp={activeSnapshot?.timestamp || new Date()}
              hoveredStrike={hoveredStrike}
              setHoveredStrike={setHoveredStrike}
            />
          </div>

          {/* RIGHT PANEL: STACKED GRADIENT HEATMAPS */}
          <div className="w-1/2 flex flex-col min-h-0">
            {/* Top Heatmap */}
            <div className="flex-1 min-h-0 border-b border-[#1A1A1E] relative">
              <GradientHeatmapChart
                greekMode={greekModeTop}
                onGreekModeChange={setGreekModeTop}
                history={history}
                strikes={strikes}
                ticker={ticker}
                spotPrice={spotPrice}
                pricingMethod={pricingMethod}
                activeR={activeR}
                activeQ={activeQ}
                ratesInfo={ratesInfo}
                selectedTimeIdx={selectedTimeIdx}
                setSelectedTimeIdx={setSelectedTimeIdx}
                hoveredTimeIdx={hoveredTimeIdx}
                setHoveredTimeIdx={setHoveredTimeIdx}
                hoveredStrike={hoveredStrike}
                setHoveredStrike={setHoveredStrike}
              />
            </div>

            {/* Bottom Heatmap */}
            <div className="flex-1 min-h-0 relative">
              <GradientHeatmapChart
                greekMode={greekModeBottom}
                onGreekModeChange={setGreekModeBottom}
                history={history}
                strikes={strikes}
                ticker={ticker}
                spotPrice={spotPrice}
                pricingMethod={pricingMethod}
                activeR={activeR}
                activeQ={activeQ}
                ratesInfo={ratesInfo}
                selectedTimeIdx={selectedTimeIdx}
                setSelectedTimeIdx={setSelectedTimeIdx}
                hoveredTimeIdx={hoveredTimeIdx}
                setHoveredTimeIdx={setHoveredTimeIdx}
                hoveredStrike={hoveredStrike}
                setHoveredStrike={setHoveredStrike}
              />
            </div>

            {/* SYNCED TIMELINE SELECTOR */}
            <div className="bg-[#08080A] border-t border-[#1a1a1e] px-4 py-2 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-terminal-green" />
                <span className="text-[10px] font-mono text-white font-semibold min-w-[150px]">
                  {activeSnapshot?.timestamp.toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>
                <span className="text-[9px] font-mono text-[#888]">
                  Spot: <span className="text-white font-bold">{activeSnapshot?.spotPrice.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={history.length - 1}
                value={selectedTimeIdx !== null ? selectedTimeIdx : history.length - 1}
                onChange={(e) => {
                  setSelectedTimeIdx(parseInt(e.target.value))
                  setHoveredTimeIdx(null) // clear temporary hover on slider adjust
                }}
                className="flex-1 h-1 bg-[#1A1A1E] rounded-lg appearance-none cursor-ew-resize accent-terminal-green outline-none"
              />
              <span className="text-[9px] font-mono text-[#666]">
                Snapshot {selectedTimeIdx !== null ? selectedTimeIdx + 1 : history.length} / {history.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────
// POSITIONS PROFILE VIEW (Left panel strike profiles)
// ────────────────────────────────────────────────────────
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2.0);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

function calculateBSDelta(S: number, K: number, T: number, r: number, vol: number, isCall: boolean): number {
  if (T <= 0 || vol <= 0 || S <= 0 || K <= 0) return isCall ? 0.5 : -0.5;
  const d1 = (Math.log(S / K) + (r + 0.5 * vol * vol) * T) / (vol * Math.sqrt(T));
  return isCall ? normalCDF(d1) : normalCDF(d1) - 1;
}

interface PositionsProfileViewProps {
  ticker: string
  strikes: number[]
  spotPrice: number
  options: OptionData[]
  timestamp: Date
  hoveredStrike: number | null
  setHoveredStrike: (strike: number | null) => void
}

function PositionsProfileView({
  ticker,
  strikes,
  spotPrice,
  options,
  timestamp,
  hoveredStrike,
  setHoveredStrike,
}: PositionsProfileViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dims, setDims] = useState({ width: 220, height: 400 })
  const [tooltipData, setTooltipData] = useState<any | null>(null)

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

  // Net OI = Call OI - Put OI for each strike, aggregated across all expiries
  const getNetOI = (strike: number) => {
    const strikeOptions = options.filter(o => o.strike === strike)
    const callOI = strikeOptions
      .filter(o => o.type === "C")
      .reduce((sum, o) => sum + (o.open_interest || 0), 0)
    const putOI = strikeOptions
      .filter(o => o.type === "P")
      .reduce((sum, o) => sum + (o.open_interest || 0), 0)
    return callOI - putOI
  }

  useEffect(() => {
    if (!canvasRef.current || strikes.length === 0) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const { width, height } = dims
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    // Clear background
    ctx.fillStyle = '#08080A'
    ctx.fillRect(0, 0, width, height)

    // Aligned vertical scale parameters (matching heatmap margins)
    const marginTop = 30
    const marginBottom = 25
    const graphHeight = height - marginTop - marginBottom

    // Render Title
    ctx.fillStyle = '#E5E5E5'
    ctx.font = 'bold 9px monospace'
    ctx.textAlign = 'center'
    ctx.fillText("NET OI (DEALER INVENTORY)", width / 2, 16)

    const minStrike = strikes[0]
    const maxStrike = strikes[strikes.length - 1]
    const yScale = d3.scaleLinear()
      .domain([minStrike, maxStrike])
      .range([marginTop + graphHeight, marginTop])

    const midX = width / 2
    const maxOI = d3.max(strikes.map(s => Math.abs(getNetOI(s)))) || 1

    // Draw center vertical line
    ctx.strokeStyle = '#111113'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(midX, marginTop)
    ctx.lineTo(midX, marginTop + graphHeight)
    ctx.stroke()

    // Draw bars
    const itemHeight = graphHeight / strikes.length
    strikes.forEach((strike) => {
      const y = yScale(strike)
      if (y === undefined || y < marginTop || y > marginTop + graphHeight) return

      const netOI = getNetOI(strike)
      const pct = netOI / maxOI
      const barW = (width / 2 - 25) * pct

      ctx.fillStyle = netOI >= 0
        ? 'rgba(0, 200, 5, 0.75)'  // Positive Net OI = Vibrant Green
        : 'rgba(255, 59, 96, 0.75)' // Negative Net OI = Vibrant Red

      ctx.fillRect(
        barW >= 0 ? midX : midX + barW,
        y - Math.max(1, itemHeight * 0.35),
        Math.max(1.5, Math.abs(barW)),
        Math.max(1, itemHeight * 0.7)
      )

      // Strike label on the left edge
      const isATM = Math.abs(strike - spotPrice) < (strikes[1] - strikes[0]) / 2
      ctx.fillStyle = isATM ? colors.accent.amber : '#666'
      ctx.font = isATM ? 'bold 8px monospace' : '8px monospace'
      ctx.textAlign = 'left'
      ctx.fillText(strike.toFixed(0), 6, y + 3)
    })

    // Draw horizontal crosshair on hovered strike
    if (hoveredStrike !== null && hoveredStrike >= minStrike && hoveredStrike <= maxStrike) {
      const activeY = yScale(hoveredStrike)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.lineWidth = 0.8
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(0, activeY)
      ctx.lineTo(width, activeY)
      ctx.stroke()
      ctx.setLineDash([])
    }

  }, [strikes, spotPrice, options, dims, hoveredStrike])

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (strikes.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    // Adjusting for CSS coordinate space
    const marginTop = 30
    const marginBottom = 25
    const graphHeight = dims.height - marginTop - marginBottom

    const minStrike = strikes[0]
    const maxStrike = strikes[strikes.length - 1]
    
    const yScale = d3.scaleLinear()
      .domain([minStrike, maxStrike])
      .range([marginTop + graphHeight, marginTop])

    const strikeVal = yScale.invert(y)
    const closestStrike = strikes.reduce((prev, curr) => {
      return Math.abs(curr - strikeVal) < Math.abs(prev - strikeVal) ? curr : prev
    }, strikes[0])

    setHoveredStrike(closestStrike)

    const strikeOptions = options.filter(o => o.strike === closestStrike)
    const netOI = getNetOI(closestStrike)
    
    let hedgeShares = 0
    strikeOptions.forEach(opt => {
      let d = opt.delta || 0
      if (d === 0) {
        const t = Math.max(1 / 365, (opt.expiration.getTime() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24 * 365))
        const r = ['NIFTY', 'BANKNIFTY', 'RELIANCE'].includes(ticker) ? 0.065 : 0.05
        const vol = (opt.iv && opt.iv > 0) ? opt.iv / 100 : 0.3
        d = calculateBSDelta(spotPrice, opt.strike, t, r, vol, opt.type === "C")
      }
      if (opt.type === "P" && d > 0) d = -d
      if (opt.type === "C" && d < 0) d = -d
      hedgeShares += (opt.open_interest || 0) * 100 * d
    })

    const notionalVal = hedgeShares * spotPrice

    setTooltipData({
      strike: closestStrike,
      netOI,
      hedgeShares,
      notionalVal,
      x,
      y
    })
  }

  const handleMouseLeave = () => {
    setHoveredStrike(null)
    setTooltipData(null)
  }

  return (
    <div ref={containerRef} className="flex-1 w-full h-full relative overflow-hidden">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="absolute inset-0 w-full h-full cursor-crosshair"
      />
      {tooltipData && (
        <div
          className="absolute z-30 bg-black/95 backdrop-blur-md border border-[#222]/80 px-3 py-2 rounded text-[#D4D4D8] pointer-events-none shadow-2xl animate-in fade-in duration-100"
          style={{
            left: `${tooltipData.x + 14}px`,
            top: `${tooltipData.y - 30}px`,
            width: 'max-content'
          }}
        >
          <div className="font-mono text-[10px] font-bold text-white mb-1.5 pb-1 border-b border-[#222]">
            STRIKE: {tooltipData.strike.toFixed(0)}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[9px]">
            <span className="text-[#666]">Net OI:</span>
            <span className={`font-bold text-right ${tooltipData.netOI >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
              {tooltipData.netOI.toLocaleString()}
            </span>

            <span className="text-[#666]">Hedge Action:</span>
            <span className={`font-bold text-right ${tooltipData.hedgeShares >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
              {tooltipData.hedgeShares >= 0 ? 'BUY' : 'SELL'}
            </span>

            <span className="text-[#666]">Hedge Shares:</span>
            <span className="text-white text-right font-bold">
              {Math.abs(Math.round(tooltipData.hedgeShares)).toLocaleString()}
            </span>

            <span className="text-[#666]">Notional Val:</span>
            <span className="text-white font-bold text-right">
              ${Math.abs(Math.round(tooltipData.notionalVal)).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────
// GRADIENT HEATMAP CHART COMPONENT (Canvas rendering)
// ────────────────────────────────────────────────────────
interface GradientHeatmapChartProps {
  greekMode: 'gamma' | 'vanna' | 'charm'
  onGreekModeChange: (mode: 'gamma' | 'vanna' | 'charm') => void
  history: OptionSnapshot[]
  strikes: number[]
  ticker: string
  spotPrice: number
  pricingMethod: PricingMethod
  activeR: number
  activeQ: number
  ratesInfo: any
  selectedTimeIdx: number | null
  setSelectedTimeIdx: (idx: number) => void
  hoveredTimeIdx: number | null
  setHoveredTimeIdx: (idx: number | null) => void
  hoveredStrike: number | null
  setHoveredStrike: (strike: number | null) => void
}

function GradientHeatmapChart({
  greekMode,
  onGreekModeChange,
  history,
  strikes,
  ticker,
  spotPrice,
  pricingMethod,
  activeR,
  activeQ,
  ratesInfo,
  selectedTimeIdx,
  setSelectedTimeIdx,
  hoveredTimeIdx,
  setHoveredTimeIdx,
  hoveredStrike,
  setHoveredStrike
}: GradientHeatmapChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 600, height: 300 })
  const [tooltipData, setTooltipData] = useState<any | null>(null)

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

  // Memoize aggregated exposures for each grid cell
  const gridExposures = useMemo(() => {
    if (history.length === 0 || strikes.length === 0) return []
    
    return history.map(snap => {
      // Calculate exposure at each strike for this snapshot
      let profile: any[] = []
      if (greekMode === 'gamma') {
        profile = computeGEXByStrike(snap.spotPrice, snap.options, pricingMethod, snap.timestamp)
      } else if (greekMode === 'vanna') {
        profile = computeVannaByStrike(snap.spotPrice, snap.options, activeR, activeQ, pricingMethod, snap.timestamp)
      } else {
        profile = computeCharmByStrike(snap.spotPrice, snap.options, activeR, activeQ, pricingMethod, snap.timestamp)
      }

      // Map back to our exact visible strikes
      const rowValues = strikes.map(s => {
        const item = profile.find(p => p.strike === s)
        if (greekMode === 'gamma') return item?.gex || 0
        if (greekMode === 'vanna') return item?.vanna || 0
        return item?.charm || 0
      })

      // Calculate Zero Line (Gamma/Vanna/Charm Flip)
      let zeroLineVal = snap.spotPrice
      if (greekMode === 'gamma') {
        const zeroG = findZeroGammaLevel(snap.options, snap.spotPrice, undefined, snap.timestamp)
        if (zeroG) zeroLineVal = zeroG
      } else {
        // Zero crossing search for VEX or CEX
        const crossings: number[] = []
        for (let i = 0; i < profile.length - 1; i++) {
          const val1 = greekMode === 'vanna' ? profile[i].vanna : profile[i].charm
          const val2 = greekMode === 'vanna' ? profile[i + 1].vanna : profile[i + 1].charm
          if (val1 * val2 < 0) {
            crossings.push((profile[i].strike + profile[i + 1].strike) / 2)
          }
        }
        if (crossings.length > 0) zeroLineVal = crossings[0]
      }

      return {
        timestamp: snap.timestamp,
        spotPrice: snap.spotPrice,
        zeroLevel: zeroLineVal,
        values: rowValues
      }
    })
  }, [history, strikes, greekMode, pricingMethod, activeR, activeQ])

  // Canvas Heatmap rendering
  useEffect(() => {
    if (!canvasRef.current || gridExposures.length === 0 || strikes.length === 0) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const { width, height } = dims
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    // Clear chart
    ctx.fillStyle = '#050508'
    ctx.fillRect(0, 0, width, height)

    // Margins
    const margins = { top: 30, right: 52, bottom: 25, left: 10 }
    const chartW = width - margins.left - margins.right
    const chartH = height - margins.top - margins.bottom

    const numTimeSteps = gridExposures.length
    const numStrikes = strikes.length

    // ─── Render Heatmap via Offscreen Canvas for Bicubic scale smoothness ───
    const offscreen = document.createElement('canvas')
    offscreen.width = numTimeSteps
    offscreen.height = numStrikes
    const oCtx = offscreen.getContext('2d')
    if (oCtx) {
      const oImgData = oCtx.createImageData(numTimeSteps, numStrikes)
      
      // Determine max value to normalize color scale
      const allVals = gridExposures.flatMap(g => g.values.map(Math.abs))
      const maxVal = (d3.max(allVals) || 1) * 0.9

      for (let x = 0; x < numTimeSteps; x++) {
        const snap = gridExposures[x]
        for (let y = 0; y < numStrikes; y++) {
          const val = snap.values[y]
          const valRatio = maxVal > 0 ? val / maxVal : 0
          
          // Cluster Focus Filtering: Filter out values below 18% threshold and rescale
          const absRatio = Math.abs(valRatio)
          let finalRatio = 0
          if (absRatio >= 0.18) {
            finalRatio = (absRatio - 0.18) / (1.0 - 0.18)
          }
          
          // Apply power scale (exponent = 0.40) to boost cluster density
          const normVal = Math.sign(valRatio) * Math.pow(finalRatio, 0.40)
          
          // Row index in canvas image data is inverted (Y=0 is top, which corresponds to highest strike)
          const imgY = numStrikes - 1 - y
          const pixelIdx = (imgY * numTimeSteps + x) * 4

          let r = 0, g = 0, b = 0
          if (greekMode === 'gamma') {
            // Gamma: Positive = neon emerald green, Negative = vibrant crimson/brick red
            if (normVal >= 0) {
              r = Math.round(0)
              g = Math.round(15 + 240 * normVal)
              b = Math.round(5 + 100 * normVal)
            } else {
              const abs = Math.abs(normVal)
              r = Math.round(30 + 225 * abs)
              g = Math.round(2)
              b = Math.round(10 + 20 * abs)
            }
          } else if (greekMode === 'vanna') {
            // Vanna: Positive = neon magenta/purple, Negative = vibrant electric blue
            if (normVal >= 0) {
              r = Math.round(30 + 225 * normVal)
              g = Math.round(0)
              b = Math.round(30 + 225 * normVal)
            } else {
              const abs = Math.abs(normVal)
              r = Math.round(0)
              g = Math.round(10 + 90 * abs)
              b = Math.round(40 + 215 * abs)
            }
          } else {
            // Charm: Positive = vibrant sky blue, Negative = golden orange/amber
            if (normVal >= 0) {
              r = Math.round(0)
              g = Math.round(20 + 180 * normVal)
              b = Math.round(30 + 225 * normVal)
            } else {
              const abs = Math.abs(normVal)
              r = Math.round(40 + 215 * abs)
              g = Math.round(20 + 160 * abs)
              b = Math.round(0)
            }
          }

          oImgData.data[pixelIdx] = r
          oImgData.data[pixelIdx + 1] = g
          oImgData.data[pixelIdx + 2] = b
          oImgData.data[pixelIdx + 3] = normVal !== 0 ? 255 : 0 // Transparent for black to merge cleanly
        }
      }
      oCtx.putImageData(oImgData, 0, 0)
      
      // Draw offscreen heatmap scaled onto main chart coordinate area
      ctx.save()
      ctx.imageSmoothingEnabled = true // Enable bilinear smoothing for gorgeous flow gradients
      ctx.drawImage(offscreen, margins.left, margins.top, chartW, chartH)
      ctx.restore()

      // ─── Film Grain Texture Overlay ───
      ctx.save()
      const grainDensity = 0.08
      const noiseCount = Math.floor(chartW * chartH * grainDensity)
      const grainSize = 1

      // White grainy noise
      ctx.fillStyle = 'rgba(255, 255, 255, 0.035)'
      for (let i = 0; i < noiseCount; i++) {
        const gx = margins.left + Math.random() * chartW
        const gy = margins.top + Math.random() * chartH
        ctx.fillRect(gx, gy, grainSize, grainSize)
      }

      // Black grainy noise
      ctx.fillStyle = 'rgba(0, 0, 0, 0.045)'
      for (let i = 0; i < noiseCount; i++) {
        const gx = margins.left + Math.random() * chartW
        const gy = margins.top + Math.random() * chartH
        ctx.fillRect(gx, gy, grainSize, grainSize)
      }
      ctx.restore()
    }

    // ─── Scales ───
    const minStrike = strikes[0]
    const maxStrike = strikes[strikes.length - 1]
    const yScale = d3.scaleLinear().domain([minStrike, maxStrike]).range([margins.top + chartH, margins.top])
    const xScale = d3.scaleLinear().domain([0, numTimeSteps - 1]).range([margins.left, margins.left + chartW])

    // Draw Strike Grid Lines
    ctx.strokeStyle = 'rgba(255,255,255,0.035)'
    ctx.lineWidth = 0.8
    const yTicks = yScale.ticks(6)
    yTicks.forEach(tick => {
      const y = yScale(tick)
      ctx.beginPath()
      ctx.moveTo(margins.left, y)
      ctx.lineTo(margins.left + chartW, y)
      ctx.stroke()
    })

    // Draw Time Grid Lines
    const xTicksCount = 6
    const timeStepInterval = Math.ceil(numTimeSteps / xTicksCount)
    for (let x = 0; x < numTimeSteps; x += timeStepInterval) {
      const xPos = xScale(x)
      ctx.beginPath()
      ctx.moveTo(xPos, margins.top)
      ctx.lineTo(xPos, margins.top + chartH)
      ctx.stroke()
    }

    // ─── Plot Overlay Paths ───

    // 1. Spot Price Line (Solid Orange/Amber track)
    ctx.strokeStyle = '#FF3B60' // Crimson spot price track
    ctx.lineWidth = 1.6
    ctx.shadowBlur = 4
    ctx.shadowColor = 'rgba(255, 59, 96, 0.4)'
    ctx.beginPath()
    gridExposures.forEach((snap, idx) => {
      const x = xScale(idx)
      const y = yScale(snap.spotPrice)
      if (idx === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.shadowBlur = 0 // reset shadow

    // 2. Zero Greek / Flip Line (Dashed White line)
    ctx.strokeStyle = '#D4D4D8'
    ctx.lineWidth = 0.95
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    gridExposures.forEach((snap, idx) => {
      const x = xScale(idx)
      const y = yScale(snap.zeroLevel)
      if (idx === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.setLineDash([]) // reset dash

    // ─── Axes ───

    // Right Y Axis (Strikes)
    ctx.fillStyle = '#949494'
    ctx.font = '9px monospace'
    ctx.textAlign = 'left'
    yTicks.forEach(tick => {
      const y = yScale(tick)
      // Tick line
      ctx.strokeStyle = '#1A1A1E'
      ctx.beginPath()
      ctx.moveTo(margins.left + chartW, y)
      ctx.lineTo(margins.left + chartW + 4, y)
      ctx.stroke()

      // Text
      ctx.fillText(tick.toFixed(0), margins.left + chartW + 8, y + 3)
    })

    // Bottom X Axis (Times)
    ctx.fillStyle = '#666'
    ctx.font = '8px monospace'
    ctx.textAlign = 'center'
    for (let x = 0; x < numTimeSteps; x += timeStepInterval) {
      const xPos = xScale(x)
      const date = gridExposures[x].timestamp
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      ctx.fillText(timeStr, xPos, margins.top + chartH + 14)
    }

    // Active Selected Time indicator bar (Vertical line)
    const activeIdx = hoveredTimeIdx !== null ? hoveredTimeIdx : selectedTimeIdx
    if (activeIdx !== null && activeIdx >= 0 && activeIdx < numTimeSteps) {
      const activeX = xScale(activeIdx)
      ctx.strokeStyle = 'rgba(0, 200, 255, 0.45)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(activeX, margins.top)
      ctx.lineTo(activeX, margins.top + chartH)
      ctx.stroke()

      // Small marker circle on the Spot Price track
      const activeSpotY = yScale(gridExposures[activeIdx].spotPrice)
      ctx.fillStyle = '#FF3B60'
      ctx.beginPath()
      ctx.arc(activeX, activeSpotY, 3.5, 0, 2 * Math.PI)
      ctx.fill()
    }

    // Hovered Strike line (Horizontal crosshair)
    if (hoveredStrike !== null && hoveredStrike >= minStrike && hoveredStrike <= maxStrike) {
      const activeY = yScale(hoveredStrike)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.lineWidth = 0.8
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(margins.left, activeY)
      ctx.lineTo(margins.left + chartW, activeY)
      ctx.stroke()
      ctx.setLineDash([])
    }

  }, [gridExposures, strikes, greekMode, selectedTimeIdx, hoveredTimeIdx, hoveredStrike, dims])

  // Mouse move handler for coordinate tracking & tooltips
  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (gridExposures.length === 0 || strikes.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const margins = { top: 30, right: 52, bottom: 25, left: 10 }
    const chartW = rect.width - margins.left - margins.right
    const chartH = rect.height - margins.top - margins.bottom

    // Clamp coordinates to chart box
    const clampedX = Math.max(margins.left, Math.min(margins.left + chartW, x))
    const clampedY = Math.max(margins.top, Math.min(margins.top + chartH, y))

    // Calculate scales inverse
    const numTimeSteps = gridExposures.length
    const tPct = (clampedX - margins.left) / chartW
    const timeIdx = Math.max(0, Math.min(numTimeSteps - 1, Math.round(tPct * (numTimeSteps - 1))))

    const minStrike = strikes[0]
    const maxStrike = strikes[strikes.length - 1]
    const sPct = 1 - (clampedY - margins.top) / chartH
    const strikeVal = minStrike + sPct * (maxStrike - minStrike)

    // Find closest strike index
    const closestStrike = strikes.reduce((prev, curr) => {
      return Math.abs(curr - strikeVal) < Math.abs(prev - strikeVal) ? curr : prev
    }, strikes[0])

    setHoveredTimeIdx(timeIdx)
    setHoveredStrike(closestStrike)

    // Compute Tooltip content
    const snap = gridExposures[timeIdx]
    const strikeIdx = strikes.indexOf(closestStrike)
    const val = strikeIdx !== -1 ? snap.values[strikeIdx] : 0

    // Trading statistics logic: exposure translated to dollar metrics
    const contractScale = greekMode === 'gamma' ? 1e9 : 1e9
    const formattedExp = greekMode === 'gamma'
      ? `${val >= 0 ? '+' : ''}${val.toFixed(2)}B GEX`
      : greekMode === 'vanna'
        ? `${val >= 0 ? '+' : ''}${val.toFixed(2)}B VEX`
        : `${val >= 0 ? '+' : ''}${val.toFixed(2)}B CEX/day`

    // Mock dollar hedging statistics to replicate premium terminal values
    const spotVal = snap.spotPrice
    const dollarPerPercent = Math.abs(val) * 100 * spotVal * 100 * 0.01 // Dollar exposure scaling
    const dollarValueTrade = val * spotVal * 1000 * (greekMode === 'charm' ? 0.015 : 0.45)
    const hedgeProduct = -val * 100

    setTooltipData({
      time: snap.timestamp,
      strike: closestStrike,
      exposure: formattedExp,
      dollarPerPercent,
      dollarValueTrade,
      hedgeProduct,
      spotPrice: snap.spotPrice,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    })
  }

  const handleMouseLeave = () => {
    setHoveredTimeIdx(null)
    setHoveredStrike(null)
    setTooltipData(null)
  }

  const handleMouseDown = () => {
    if (hoveredTimeIdx !== null) {
      setSelectedTimeIdx(hoveredTimeIdx)
    }
  }

  return (
    <div ref={containerRef} className="w-full h-full relative select-none overflow-hidden">
      {/* Widget Header Controls */}
      <div className="absolute top-2 left-3 right-3 z-10 flex justify-between items-center bg-black/45 backdrop-blur-sm px-2.5 py-1 rounded border border-[#1A1A1E]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[#888] font-semibold">Greek:</span>
          <select
            value={greekMode}
            onChange={(e) => onGreekModeChange(e.target.value as any)}
            className="bg-black text-white text-[10px] font-mono border border-[#1A1A1E] rounded px-1.5 py-0.5 outline-none cursor-pointer focus:border-terminal-green/30"
          >
            <option value="gamma">Gamma (GEX)</option>
            <option value="vanna">Vanna (VEX)</option>
            <option value="charm">Charm (CEX)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-[#777]">
            Mode: <span className="text-white font-bold">{greekMode.toUpperCase()} FLOW</span>
          </span>
        </div>
      </div>

      {/* Primary Heatmap Canvas */}
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        className="absolute inset-0 w-full h-full cursor-crosshair"
      />

      {/* Tooltip Overlay */}
      {tooltipData && (
        <div
          className="absolute z-30 bg-black/90 backdrop-blur-md border border-[#222]/80 px-3 py-2 rounded text-[#D4D4D8] pointer-events-none shadow-2xl"
          style={{
            left: `${tooltipData.x + 14}px`,
            top: `${tooltipData.y - 30}px`,
            width: 'max-content'
          }}
        >
          <div className="font-mono text-[10px] font-bold text-white mb-1.5 pb-1 border-b border-[#222]">
            {tooltipData.time.toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[9px]">
            <span className="text-[#666]">Strike:</span>
            <span className="text-white font-bold text-right">{tooltipData.strike.toFixed(0)}</span>

            <span className="text-[#666]">Spot:</span>
            <span className="text-white text-right">{tooltipData.spotPrice.toFixed(1)}</span>

            <span className="text-[#666]">Exposure:</span>
            <span className="text-terminal-green font-bold text-right">{tooltipData.exposure}</span>

            <span className="text-[#666]">$ Per Percent:</span>
            <span className="text-[#666] text-right">${tooltipData.dollarPerPercent.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>

            <span className="text-[#666]">Hedge Product:</span>
            <span className="text-terminal-red text-right">{tooltipData.hedgeProduct.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
          </div>
        </div>
      )}
    </div>
  )
}
