"use client"

import { useEffect, useRef, useState, useMemo } from "react"
import * as d3 from "d3"
import { Settings2, Minus, Plus, Maximize2, Activity, Play, Pause, Clock } from "lucide-react"
import type { OptionData } from "@/lib/types"
import {
  computeGEXByStrike,
  computeVannaByStrike,
  computeCharmByStrike,
  computeDeltaByStrike,
  findZeroGammaLevel,
  type PricingMethod
} from "@/lib/calculations"
import { colors, typography } from "@/lib/design-tokens"
import { BACKEND_URL } from "@/lib/backend-api"
import * as echarts from "echarts"

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
  const [error, setError] = useState<string | null>(null)
  const [ratesInfo, setRatesInfo] = useState({
    usRiskFreeRate: 0.05,
    indiaRiskFreeRate: 0.065,
    source: "Assumed Defaults"
  })

  // Chart configuration states
  const [greekModeTop, setGreekModeTop] = useState<'gamma' | 'vanna' | 'charm' | 'delta'>('gamma')
  const [greekModeBottom, setGreekModeBottom] = useState<'gamma' | 'vanna' | 'charm' | 'delta'>('charm')
  const [activeZoom, setActiveZoom] = useState<number>(3) // ±3% by default
  const [rthOnly, setRthOnly] = useState(true)

  // Synchronization states
  const [selectedTimeIdx, setSelectedTimeIdx] = useState<number | null>(null)
  const [hoveredTimeIdx, setHoveredTimeIdx] = useState<number | null>(null)
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null)

  const [yahooCandles, setYahooCandles] = useState<any[]>([])

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

  // Fetch Yahoo Finance 5-minute candles
  useEffect(() => {
    fetch(`/api/history/${ticker}?timeframe=5m`)
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.candles)) {
          setYahooCandles(data.candles)
        }
      })
      .catch(err => console.error("Error loading Yahoo Finance candles in gradient view:", err))
  }, [ticker, optionData])

  const fitToView = () => {
    if (history.length === 0) return
    const allStrikes = Array.from(new Set(history[0].options.map(o => o.strike)))
    if (allStrikes.length === 0) return
    const maxDiff = Math.max(...allStrikes.map(s => Math.abs(s - spotPrice)))
    const pct = Math.ceil((maxDiff / spotPrice) * 100)
    setActiveZoom(Math.min(10, Math.max(1, pct)))
  }

  const activeR = market === 'INDIA' ? ratesInfo.indiaRiskFreeRate : ratesInfo.usRiskFreeRate
  const activeQ = market === 'INDIA' ? 0.012 : 0.013

  // Load history (no mock generator fallback)
  useEffect(() => {
    setLoading(true)
    setError(null)
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
          throw new Error("Insufficient historical database records to construct heatmaps.")
        }
      })
      .catch(err => {
        console.warn(err.message)
        setError(err.message || "Failed to load historical options chain data.")
        setHistory([])
        setSelectedTimeIdx(null)
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

          <button
            onClick={() => setActiveZoom(3)}
            className="px-2 py-0.5 rounded text-[9px] font-mono border border-[#1A1A1E] text-[#888] hover:text-white hover:bg-[#111] transition-colors font-bold"
            title="Reset Zoom (±3%)"
            type="button"
          >
            Reset
          </button>
          <button
            onClick={fitToView}
            className="px-2 py-0.5 rounded text-[9px] font-mono border border-[#1A1A1E] text-[#888] hover:text-white hover:bg-[#111] transition-colors font-bold"
            title="Fit to View (Show all strikes)"
            type="button"
          >
            Fit
          </button>

          {/* RTH Fixed Indicator */}
          <button
            className="px-2.5 py-0.5 rounded text-[9px] font-mono font-bold border bg-terminal-green/15 text-terminal-green border-terminal-green/30 cursor-default"
            type="button"
            title="Regular Trading Hours (RTH)"
            disabled
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
      ) : error || history.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-black text-[#666] font-mono text-xs gap-2">
          <span>⚠️ {error || "No historical options chain series available."}</span>
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
                yahooCandles={yahooCandles}
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
                yahooCandles={yahooCandles}
              />
            </div>

            {/* SYNCED TIMELINE SELECTOR */}
            <div className="bg-[#08080A] border-t border-[#1a1a1e] px-4 py-2 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-terminal-green" />
                <span className="text-[10px] font-mono text-white font-semibold min-w-[150px]">
                  {activeSnapshot?.timestamp ? (activeSnapshot.timestamp instanceof Date ? activeSnapshot.timestamp : new Date(activeSnapshot.timestamp)).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  }) : 'N/A'}
                </span>
                <span className="text-[9px] font-mono text-[#888]">
                  Spot: <span className="text-white font-bold">{activeSnapshot?.spotPrice !== undefined ? activeSnapshot.spotPrice.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : 'N/A'}</span>
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
// GRADIENT HEATMAP CHART COMPONENT (Apache ECharts + SVG)
// ────────────────────────────────────────────────────────
interface GradientHeatmapChartProps {
  greekMode: 'gamma' | 'vanna' | 'charm' | 'delta'
  onGreekModeChange: (mode: 'gamma' | 'vanna' | 'charm' | 'delta') => void
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
  yahooCandles: any[]
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
  setHoveredStrike,
  yahooCandles
}: GradientHeatmapChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstanceRef = useRef<echarts.ECharts | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltipData, setTooltipData] = useState<any | null>(null)
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number; valX: number; valY: number } | null>(null)
  const [gridRect, setGridRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [svgPaths, setSvgPaths] = useState({
    callWall: '',
    putWall: ''
  })
  const [svgCandles, setSvgCandles] = useState<any[]>([])

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
      } else if (greekMode === 'charm') {
        profile = computeCharmByStrike(snap.spotPrice, snap.options, activeR, activeQ, pricingMethod, snap.timestamp)
      } else {
        profile = computeDeltaByStrike(snap.spotPrice, snap.options, pricingMethod, snap.timestamp)
      }

      // Map back to our exact visible strikes
      const rowValues = strikes.map(s => {
        const item = profile.find(p => p.strike === s)
        if (greekMode === 'gamma') return item?.gex || 0
        if (greekMode === 'vanna') return item?.vanna || 0
        if (greekMode === 'charm') return item?.charm || 0
        return item?.delta || 0
      })

      // Always resolve Gamma Call/Put walls to draw the SVG overlay lines
      const gexProfile = computeGEXByStrike(snap.spotPrice, snap.options, pricingMethod, snap.timestamp)
      let callWallStrike: number | null = null
      let maxGex = -Infinity
      let putWallStrike: number | null = null
      let minGex = Infinity

      gexProfile.forEach(p => {
        if (p.gex > maxGex && p.gex > 0) {
          maxGex = p.gex
          callWallStrike = p.strike
        }
        if (p.gex < minGex && p.gex < 0) {
          minGex = p.gex
          putWallStrike = p.strike
        }
      })

      return {
        timestamp: snap.timestamp,
        spotPrice: snap.spotPrice,
        callWall: callWallStrike,
        putWall: putWallStrike,
        values: rowValues
      }
    })
  }, [history, strikes, greekMode, pricingMethod, activeR, activeQ])

  const timeLabels = useMemo(() => {
    return gridExposures.map(g => g.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }))
  }, [gridExposures])

  const strikeLabels = useMemo(() => {
    return strikes.map(s => s.toString())
  }, [strikes])

  const heatmapData = useMemo(() => {
    const data: [number, number, number][] = []
    gridExposures.forEach((snap, x) => {
      snap.values.forEach((v, y) => {
        data.push([x, y, v])
      })
    })
    return data
  }, [gridExposures])

  const maxVal = useMemo(() => {
    let maxAbs = 0
    gridExposures.forEach(snap => {
      snap.values.forEach(v => {
        const absVal = Math.abs(v)
        if (absVal > maxAbs) maxAbs = absVal
      })
    })
    return maxAbs > 0 ? maxAbs * 0.95 : 1.0
  }, [gridExposures])

  const colorsMap = useMemo(() => {
    if (greekMode === 'gamma' || greekMode === 'delta') {
      return [colors.accent.red, '#0A0A0A', colors.accent.green] // Red -> Black -> Green
    }
    if (greekMode === 'vanna') {
      return [colors.accent.cyan, '#0A0A0A', colors.accent.purple] // Cyan -> Black -> Purple
    }
    return [colors.accent.amber, '#0A0A0A', colors.accent.cyan] // Amber -> Black -> Cyan
  }, [greekMode])

  const getStrikeIndex = (strikeVal: number) => {
    if (strikes.length === 0) return 0
    const exactIdx = strikes.indexOf(strikeVal)
    if (exactIdx !== -1) return exactIdx

    if (strikeVal <= strikes[0]) return 0
    if (strikeVal >= strikes[strikes.length - 1]) return strikes.length - 1

    for (let i = 0; i < strikes.length - 1; i++) {
      if (strikeVal >= strikes[i] && strikeVal <= strikes[i + 1]) {
        const pct = (strikeVal - strikes[i]) / (strikes[i + 1] - strikes[i])
        return i + pct
      }
    }
    return 0
  }

  const getYPixel = (chart: echarts.ECharts, price: number) => {
    const idx = getStrikeIndex(price)
    const pixel = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [0, idx])
    return pixel ? pixel[1] : 0
  }

  const updateOverlayPaths = () => {
    const chart = chartInstanceRef.current
    if (!chart || gridExposures.length === 0 || strikes.length === 0) return

    const numTimeSteps = gridExposures.length
    
    // Resolve extreme corners for gridRect boundary
    const x0 = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [0, 0])?.[0]
    const x1 = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [numTimeSteps - 1, 0])?.[0]
    const y0 = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [0, 0])?.[1]
    const y1 = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [0, strikes.length - 1])?.[1]

    if (x0 === undefined || x1 === undefined || y0 === undefined || y1 === undefined || isNaN(x0) || isNaN(y0)) return

    const left = Math.min(x0, x1)
    const right = Math.max(x0, x1)
    const top = Math.min(y0, y1)
    const bottom = Math.max(y0, y1)

    const colW = numTimeSteps > 1 ? Math.abs(x0 - x1) / (numTimeSteps - 1) : 10
    const rowH = strikes.length > 1 ? Math.abs(y0 - y1) / (strikes.length - 1) : 10

    const clipLeft = left - colW / 2
    const clipRight = right + colW / 2
    const clipTop = top - rowH / 2
    const clipBottom = bottom + rowH / 2

    setGridRect({
      left: clipLeft,
      top: clipTop,
      width: clipRight - clipLeft,
      height: clipBottom - clipTop
    })

    // 1. Call Wall & Put Wall paths
    const pointsCallWall: string[] = []
    const pointsPutWall: string[] = []

    gridExposures.forEach((snap, idx) => {
      if (snap.callWall !== null) {
        const callIdx = getStrikeIndex(snap.callWall)
        const pixelCall = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [idx, callIdx])
        if (pixelCall && !isNaN(pixelCall[0]) && !isNaN(pixelCall[1])) {
          pointsCallWall.push(`${pixelCall[0]},${pixelCall[1]}`)
        }
      }
      if (snap.putWall !== null) {
        const putIdx = getStrikeIndex(snap.putWall)
        const pixelPut = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [idx, putIdx])
        if (pixelPut && !isNaN(pixelPut[0]) && !isNaN(pixelPut[1])) {
          pointsPutWall.push(`${pixelPut[0]},${pixelPut[1]}`)
        }
      }
    })

    setSvgPaths({
      callWall: pointsCallWall.length > 0 ? `M ${pointsCallWall.join(' L ')}` : '',
      putWall: pointsPutWall.length > 0 ? `M ${pointsPutWall.join(' L ')}` : ''
    })

    // 2. Candlesticks Overlay Calculation (No fallbacks / mock candles)
    const candlesToRender: any[] = []
    gridExposures.forEach((snap, idx) => {
      const snapTime = snap.timestamp.getTime()
      
      // Match with the closest real candle within 5m
      const closestCandle = yahooCandles.find(c => Math.abs(c.timestamp - snapTime) <= 5 * 60 * 1000)
      
      if (closestCandle) {
        const x = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [idx, 0])?.[0]
        const yOpen = getYPixel(chart, closestCandle.open)
        const yHigh = getYPixel(chart, closestCandle.high)
        const yLow = getYPixel(chart, closestCandle.low)
        const yClose = getYPixel(chart, closestCandle.close)

        if (x !== undefined && !isNaN(x) && !isNaN(yOpen) && !isNaN(yClose)) {
          candlesToRender.push({
            x,
            yOpen,
            yClose,
            yHigh,
            yLow,
            width: Math.max(3, colW * 0.5),
            isUp: closestCandle.close >= closestCandle.open
          })
        }
      }
    })
    setSvgCandles(candlesToRender)
  }

  // Ref to wrap updateOverlayPaths to avoid stale closure issues in chart handlers
  const updateOverlayPathsRef = useRef(updateOverlayPaths)
  useEffect(() => {
    updateOverlayPathsRef.current = updateOverlayPaths
  })

  // Initialize ECharts once
  useEffect(() => {
    if (!chartRef.current) return

    const chart = echarts.init(chartRef.current, null, {
      renderer: 'canvas'
    })
    chartInstanceRef.current = chart

    const handleResize = () => {
      chart.resize()
      updateOverlayPathsRef.current()
    }
    window.addEventListener('resize', handleResize)

    chart.on('finished', () => {
      updateOverlayPathsRef.current()
    })

    chart.on('dataZoom', () => {
      updateOverlayPathsRef.current()
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.dispose()
      chartInstanceRef.current = null
    }
  }, [])

  // Update ECharts options when data changes
  useEffect(() => {
    const chart = chartInstanceRef.current
    if (!chart || gridExposures.length === 0 || strikes.length === 0) return

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: { show: false },
      grid: {
        top: 40,
        bottom: 25,
        left: 10,
        right: 52,
        containLabel: false
      },
      xAxis: {
        type: 'category',
        data: timeLabels,
        splitLine: {
          show: true,
          lineStyle: {
            color: 'rgba(255, 255, 255, 0.02)',
            width: 0.8
          }
        },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#666',
          fontFamily: 'monospace',
          fontSize: 8,
          interval: Math.ceil(timeLabels.length / 6) - 1
        }
      },
      yAxis: {
        type: 'category',
        data: strikeLabels,
        splitLine: {
          show: true,
          lineStyle: {
            color: 'rgba(255, 255, 255, 0.02)',
            width: 0.8
          }
        },
        axisLine: { show: false },
        axisTick: {
          show: true,
          lineStyle: { color: '#1A1A1E' }
        },
        axisLabel: {
          color: '#949494',
          fontFamily: 'monospace',
          fontSize: 9
        },
        position: 'right'
      },
      visualMap: {
        show: false,
        min: -maxVal,
        max: maxVal,
        calculable: true,
        inRange: {
          color: colorsMap
        }
      },
      series: [
        {
          name: 'Exposure',
          type: 'heatmap',
          data: heatmapData,
          progressive: 1000,
          animation: false
        }
      ]
    }

    chart.setOption(option, true)

    // Trigger overlays setup shortly after render
    setTimeout(() => {
      updateOverlayPaths()
    }, 50)
  }, [gridExposures, strikes, timeLabels, strikeLabels, heatmapData, maxVal, colorsMap])

  // Mouse move and hover coordinates listener
  useEffect(() => {
    const chart = chartInstanceRef.current
    if (!chart) return

    const handleMouseMove = (params: any) => {
      if (params.seriesType === 'heatmap' && params.value) {
        const timeIdx = params.value[0]
        const strikeIdx = params.value[1]
        const val = params.value[2]

        const snap = gridExposures[timeIdx]
        const closestStrike = strikes[strikeIdx]

        if (!snap) return

        setHoveredTimeIdx(timeIdx)
        setHoveredStrike(closestStrike)

        const rawEvent = params.event?.event
        if (rawEvent) {
          const rect = chart.getDom().getBoundingClientRect()
          const x = rawEvent.clientX - rect.left
          const y = rawEvent.clientY - rect.top

          const pixelX = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [timeIdx, 0])?.[0] || x
          const pixelY = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [0, strikeIdx])?.[1] || y

          setCrosshairPos({
            x: pixelX,
            y: pixelY,
            valX: timeIdx,
            valY: closestStrike
          })

          const formatExposure = (v: number) => {
            const absVal = Math.abs(v)
            const sign = v >= 0 ? '+' : '-'
            let formatted = ''
            if (absVal >= 1.0) {
              formatted = `${sign}$${absVal.toFixed(2)}B`
            } else {
              formatted = `${sign}$${(absVal * 1000).toFixed(1)}M`
            }

            if (greekMode === 'gamma') return `${formatted} GEX`
            if (greekMode === 'vanna') return `${formatted} VEX`
            if (greekMode === 'charm') return `${formatted} CEX/day`
            return `${formatted} DEX`
          }

          const dollarPerPercent = Math.abs(val) * 1e9 * 0.01
          const hedgeShares = -val * 1e9 / snap.spotPrice

          setTooltipData({
            time: snap.timestamp,
            strike: closestStrike,
            exposure: formatExposure(val),
            val,
            dollarPerPercent,
            hedgeShares,
            spotPrice: snap.spotPrice,
            x,
            y
          })
        }
      }
    }

    const handleMouseOut = () => {
      setHoveredTimeIdx(null)
      setHoveredStrike(null)
      setTooltipData(null)
      setCrosshairPos(null)
    }

    chart.on('mousemove', handleMouseMove)
    chart.on('globalout', handleMouseOut)

    const handleMouseDown = (params: any) => {
      if (params.seriesType === 'heatmap' && params.value) {
        const timeIdx = params.value[0]
        setSelectedTimeIdx(timeIdx)
      }
    }
    chart.on('mousedown', handleMouseDown)

    return () => {
      chart.off('mousemove', handleMouseMove)
      chart.off('globalout', handleMouseOut)
      chart.off('mousedown', handleMouseDown)
    }
  }, [gridExposures, strikes, greekMode])

  const selectedX = useMemo(() => {
    if (selectedTimeIdx === null || !chartInstanceRef.current || gridExposures.length === 0) return null
    const pixel = chartInstanceRef.current.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [selectedTimeIdx, 0])
    return (pixel && !isNaN(pixel[0])) ? pixel[0] : null
  }, [selectedTimeIdx, gridExposures.length, gridRect])

  return (
    <div ref={containerRef} className="w-full h-full relative select-none overflow-hidden bg-black">
      {/* Widget Header Controls */}
      <div className="absolute top-2 left-3 right-3 z-30 flex justify-between items-center bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded border border-[#1A1A1E]">
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
            <option value="delta">Delta (DEX)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-[#777]">
            Mode: <span className="text-white font-bold">{greekMode.toUpperCase()} FLOW</span>
          </span>
        </div>
      </div>

      {/* ECharts Heatmap Container */}
      <div ref={chartRef} className="w-full h-full absolute inset-0" />

      {/* SVG Volatility Walls & Candlesticks Overlay */}
      {gridRect && (
        <svg className="absolute inset-0 pointer-events-none w-full h-full z-20">
          <defs>
            <clipPath id={`grid-clip-${greekMode}`}>
              <rect
                x={gridRect.left}
                y={gridRect.top}
                width={gridRect.width}
                height={gridRect.height}
              />
            </clipPath>
          </defs>
          <g clipPath={`url(#grid-clip-${greekMode})`}>
            {/* Call Wall Line */}
            {svgPaths.callWall && (
              <path
                d={svgPaths.callWall}
                fill="none"
                stroke={colors.accent.green}
                strokeWidth="1.5"
                opacity="0.85"
              />
            )}

            {/* Put Wall Line */}
            {svgPaths.putWall && (
              <path
                d={svgPaths.putWall}
                fill="none"
                stroke={colors.accent.red}
                strokeWidth="1.5"
                opacity="0.85"
              />
            )}

            {/* Candlesticks */}
            {svgCandles.map((c, i) => (
              <g key={i} opacity="0.9">
                {/* Wick */}
                <line
                  x1={c.x}
                  y1={c.yHigh}
                  x2={c.x}
                  y2={c.yLow}
                  stroke={c.isUp ? colors.accent.green : colors.accent.red}
                  strokeWidth="1.2"
                />
                {/* Body */}
                <rect
                  x={c.x - c.width / 2}
                  y={Math.min(c.yOpen, c.yClose)}
                  width={c.width}
                  height={Math.max(1.5, Math.abs(c.yOpen - c.yClose))}
                  fill={c.isUp ? colors.accent.green : colors.accent.red}
                  stroke={c.isUp ? colors.accent.green : colors.accent.red}
                  strokeWidth="0.5"
                />
              </g>
            ))}

            {/* Active Selected Time marker line */}
            {selectedX !== null && (
              <line
                x1={selectedX}
                y1={gridRect.top}
                x2={selectedX}
                y2={gridRect.top + gridRect.height}
                stroke="rgba(0, 200, 255, 0.4)"
                strokeWidth="1.2"
                strokeDasharray="2 2"
              />
            )}

            {/* Hover Crosshairs */}
            {hoveredTimeIdx !== null && crosshairPos && (
              <>
                {/* Vertical Hover Line */}
                <line
                  x1={crosshairPos.x}
                  y1={gridRect.top}
                  x2={crosshairPos.x}
                  y2={gridRect.top + gridRect.height}
                  stroke="rgba(255, 255, 255, 0.15)"
                  strokeWidth="0.8"
                  strokeDasharray="2 2"
                />
                {/* Horizontal Hover Line */}
                <line
                  x1={gridRect.left}
                  y1={crosshairPos.y}
                  x2={gridRect.left + gridRect.width}
                  y2={crosshairPos.y}
                  stroke="rgba(255, 255, 255, 0.15)"
                  strokeWidth="0.8"
                  strokeDasharray="2 2"
                />
              </>
            )}
          </g>
        </svg>
      )}

      {/* Tooltip Overlay */}
      {tooltipData && (
        <div
          className="absolute z-30 bg-black/90 backdrop-blur-md border border-[#222]/80 px-3 py-2 rounded text-[#D4D4D8] pointer-events-none shadow-2xl animate-in fade-in duration-100"
          style={{
            left: `${tooltipData.x + 14}px`,
            top: `${tooltipData.y - 30}px`,
            width: 'max-content'
          }}
        >
          <div className="font-mono text-[10px] font-bold text-white mb-1.5 pb-1 border-b border-[#222]">
            {tooltipData.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[9px]">
            <span className="text-[#666]">Strike:</span>
            <span className="text-white font-bold text-right">{tooltipData.strike.toFixed(0)}</span>

            <span className="text-[#666]">Spot:</span>
            <span className="text-white text-right">{tooltipData.spotPrice.toFixed(1)}</span>

            <span className="text-[#666]">Exposure:</span>
            <span className={tooltipData.val >= 0 ? 'text-terminal-green font-bold text-right' : 'text-terminal-red font-bold text-right'}>
              {tooltipData.exposure}
            </span>

            <span className="text-[#666]">$ Per Percent:</span>
            <span className="text-white text-right">${tooltipData.dollarPerPercent.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>

            <span className="text-[#666]">Hedge Action:</span>
            <span className={`font-bold text-right ${tooltipData.val >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
              {tooltipData.val >= 0 ? 'BUY' : 'SELL'}
            </span>

            <span className="text-[#666]">Hedge Shares:</span>
            <span className="text-white text-right font-bold">
              {Math.abs(Math.round(tooltipData.hedgeShares)).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
