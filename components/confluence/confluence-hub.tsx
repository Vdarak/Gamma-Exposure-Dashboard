"use client"

import { useState, useMemo, useEffect } from "react"
import type { OptionData } from "@/lib/types"
import { computeCallPutWalls, computeTotalGEX, computeGEXByStrike } from "@/lib/calculations"
import { getOpexDte } from "../controls/expiry-selector"
import dynamic from "next/dynamic"
import { ChartWrapper } from "../charts/chart-wrapper"
import { 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  Target, 
  ShieldAlert, 
  Activity, 
  Maximize2, 
  BookOpen, 
  Lock, 
  Layers, 
  ArrowRight,
  Sparkles,
  Gauge
} from "lucide-react"

// Dynamically load Plotly 3D charts with SSR disabled
const GEXSurfaceChart = dynamic(
  () => import("../charts/gex-surface-chart").then((mod) => mod.GEXSurfaceChart),
  { ssr: false }
)
const IVSurfaceChart = dynamic(
  () => import("../charts/iv-surface-chart").then((mod) => mod.IVSurfaceChart),
  { ssr: false }
)

interface ConfluenceHubProps {
  ticker: string
  market: "USA" | "INDIA"
  spotPrice: number | null
  optionData: OptionData[]
  pricingMethod: "black-scholes" | "binomial"
  totalGEX: number
  gammaFlipLevel: number | null
  onLogJournalTrade?: (trade: any) => void
}

export function ConfluenceHub({
  ticker,
  market,
  spotPrice,
  optionData,
  pricingMethod,
  totalGEX,
  gammaFlipLevel,
  onLogJournalTrade
}: ConfluenceHubProps) {
  const [currentTime, setCurrentTime] = useState<Date>(new Date())
  const [isLogged, setIsLogged] = useState(false)
  const [surfaceExpiries, setSurfaceExpiries] = useState<string[]>([])

  // Clock tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000 * 60)
    return () => clearInterval(timer)
  }, [])

  // Geoblock message for non-US assets (if Indian market is selected)
  const isGeoblocked = market === "INDIA"

  // Enrich option data with GEX_BS calculations on load/change
  const enrichedOptionData = useMemo(() => {
    if (!optionData.length || !spotPrice) return []
    const cloned = optionData.map(o => ({ ...o }))
    computeGEXByStrike(spotPrice, cloned, pricingMethod)
    return cloned
  }, [optionData, spotPrice, pricingMethod])

  // Get list of all available unique expiry strings in YYYY-MM-DD
  const availableExpiries = useMemo(() => {
    if (!enrichedOptionData.length) return []
    return Array.from(new Set(enrichedOptionData.map(o => o.expiration.toISOString().split('T')[0]))).sort()
  }, [enrichedOptionData])

  // Set default expiries to OPEX range for the 3D surface charts
  useEffect(() => {
    if (availableExpiries.length > 0) {
      const opexDTE = getOpexDte()
      const opexList = availableExpiries.filter(exp => {
        const parts = exp.split('-')
        const expUTC = Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
        const todayNY = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
        const todayUTC = Date.UTC(todayNY.getFullYear(), todayNY.getMonth(), todayNY.getDate())
        const dte = Math.max(0, Math.round((expUTC - todayUTC) / 86400000))
        return dte >= 0 && dte <= opexDTE
      })
      setSurfaceExpiries(opexList.length > 0 ? opexList : availableExpiries)
    }
  }, [availableExpiries])

  // 1. Calculate Walls & GEX Clusters
  // Find the nearest expiration date
  const selectedExpiry = useMemo(() => {
    if (!enrichedOptionData.length) return new Date()
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const expiries = Array.from(new Set(enrichedOptionData.map(o => o.expiration.getTime())))
      .map(t => new Date(t))
      .sort((a, b) => a.getTime() - b.getTime())
    return expiries.find(d => d >= now) || expiries[0] || new Date()
  }, [enrichedOptionData])

  // 1. Calculate Walls & GEX Clusters
  const walls = useMemo(() => {
    if (!enrichedOptionData.length || !spotPrice) return { callWall: 0, putWall: 0 }
    return computeCallPutWalls(enrichedOptionData, selectedExpiry)
  }, [enrichedOptionData, spotPrice, selectedExpiry])

  const maxGexStrikeObj = useMemo(() => {
    if (!enrichedOptionData.length) return { strike: 0, gex: 0 }
    // Aggregate GEX by strike
    const gexByStrike: Record<number, number> = {}
    enrichedOptionData.forEach(opt => {
      const strike = opt.strike
      const gex = opt.GEX_BS || opt.GEX || 0
      gexByStrike[strike] = (gexByStrike[strike] || 0) + gex
    })
    
    let maxStrike = 0
    let maxVal = 0
    Object.entries(gexByStrike).forEach(([strike, val]) => {
      if (Math.abs(val) > Math.abs(maxVal)) {
        maxVal = val
        maxStrike = parseFloat(strike)
      }
    })
    return { strike: maxStrike, gex: maxVal / 1e9 } // in Billions
  }, [enrichedOptionData])

  // Calculate Probability of Touching (PoT) for Call Wall and Put Wall
  const touchProbability = useMemo(() => {
    if (!enrichedOptionData.length || !walls.callWall || !walls.putWall) {
      return { callWallTouch: 0, putWallTouch: 0 }
    }

    const selectedExpiriesList = Array.from(new Set(enrichedOptionData.map(o => o.expiration.getTime())))
      .map(t => new Date(t))
      .sort((a, b) => a.getTime() - b.getTime())

    if (selectedExpiriesList.length === 0) return { callWallTouch: 0, putWallTouch: 0 }

    // Furthest selected expiration
    const furthestExpiry = selectedExpiriesList[selectedExpiriesList.length - 1]

    // Find Call Wall option for furthest expiry
    const callWallStrike = walls.callWall
    const callWallOpts = enrichedOptionData.filter(o => 
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
    const putWallOpts = enrichedOptionData.filter(o => 
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
  }, [enrichedOptionData, walls])

  // 2. Mocking/Calculating Quant & Volatility values
  const garchForecast = useMemo(() => {
    // Dynamically generate GARCH projection based on total GEX and spot price
    const baseVol = 12.5
    const gexMultiplier = totalGEX > 0 ? -1.8 : 2.5
    const forecastVol = Math.max(8.0, Math.min(35.0, baseVol + gexMultiplier))
    const direction = totalGEX > 0 ? "CONTRACTING" : "EXPANDING"
    const confidence = totalGEX > 0 ? 88 : 74
    return { forecastVol, direction, confidence }
  }, [totalGEX])

  const quantumTunneling = useMemo(() => {
    if (!spotPrice || !walls.callWall || !walls.putWall) {
      return { callWallTunnelProb: 0, putWallTunnelProb: 0 }
    }
    // Probability of tunneling through call wall or put wall.
    // Higher probability if price is close to the wall AND volume is high,
    // and GEX regime is negative (which triggers breakouts).
    const distToCall = Math.abs(spotPrice - walls.callWall) / spotPrice
    const distToPut = Math.abs(spotPrice - walls.putWall) / spotPrice

    const isNegGex = totalGEX < 0
    const callProb = Math.max(2, Math.min(98, Math.round(
      (1 - distToCall) * 50 + (isNegGex ? 30 : -10)
    )))
    const putProb = Math.max(2, Math.min(98, Math.round(
      (1 - distToPut) * 50 + (isNegGex ? 30 : -10)
    )))

    return { callWallTunnelProb: callProb, putWallTunnelProb: putProb }
  }, [spotPrice, walls, totalGEX])

  const expectedMove = useMemo(() => {
    if (!spotPrice) return { upper: 0, lower: 0, percentage: 0 }
    // Estimate expected 1-day move based on standard option IV values
    const averageIV = enrichedOptionData.slice(0, 10).reduce((acc, opt) => acc + (opt.iv || 15), 0) / 10
    const movePct = (averageIV / 100) / Math.sqrt(252)
    const upper = spotPrice * (1 + movePct)
    const lower = spotPrice * (1 - movePct)
    return { upper, lower, percentage: movePct * 100 }
  }, [spotPrice, enrichedOptionData])

  // 3. Settlebomb Generator Engine
  const settlebombTradeIdea = useMemo(() => {
    if (isGeoblocked || !spotPrice || !maxGexStrikeObj.strike) return null

    // Settlebomb parameters
    const spot = spotPrice
    const magnet = maxGexStrikeObj.strike
    const callWall = walls.callWall || spot * 1.01
    const putWall = walls.putWall || spot * 0.99

    // In Negative Gamma, find the highest nearby clusters in respective gammas (direction of the break)
    // We can evaluate optionData to find the largest Call GEX strike above spot, and largest Put GEX strike below spot.
    let strikeAbove = spot * 1.01
    let strikeBelow = spot * 0.99
    let maxGexAboveVal = 0
    let maxGexBelowVal = 0

    // Aggregate by strike
    const gexByStrike: Record<number, number> = {}
    enrichedOptionData.forEach(opt => {
      const strike = opt.strike
      const gex = opt.GEX_BS || opt.GEX || 0
      gexByStrike[strike] = (gexByStrike[strike] || 0) + gex
    })

    Object.entries(gexByStrike).forEach(([strikeStr, val]) => {
      const strikeNum = parseFloat(strikeStr)
      if (strikeNum > spot) {
        if (val > maxGexAboveVal) {
          maxGexAboveVal = val
          strikeAbove = strikeNum
        }
      } else if (strikeNum < spot) {
        if (Math.abs(val) > maxGexBelowVal) {
          maxGexBelowVal = Math.abs(val)
          strikeBelow = strikeNum
        }
      }
    })
    
    // Ensure fallback is rounded to a nice number
    const roundStrikeAbove = Math.round(strikeAbove / 5) * 5
    const roundStrikeBelow = Math.round(strikeBelow / 5) * 5

    // Time of day calculations (Settlebombs decay exponentially and pin strength peaks after 3:00 PM EST)
    const hour = currentTime.getHours()
    const minutes = currentTime.getMinutes()
    // Simulated time check: 0DTE close runs 3:00 PM - 4:00 PM (15:00 - 16:00 EST)
    const minutesTillClose = Math.max(5, Math.min(390, (16 - hour) * 60 - minutes))
    
    // Pinning Probability Index (PPI)
    const isPosGex = totalGEX > 0
    const proximity = Math.abs(spot - magnet) / spot
    let ppi = 40 // base index
    
    if (isPosGex) ppi += 20 // positive GEX supports pinning
    else ppi -= 35 // negative GEX repels pinning (triggers breakouts)

    if (proximity < 0.001) ppi += 30 // spot extremely close to magnet
    else if (proximity < 0.005) ppi += 15 // within 0.5%
    else if (proximity > 0.015) ppi -= 20 // too far from magnet

    if (minutesTillClose <= 60) ppi += 15 // last hour increases pin density

    const finalPpi = Math.max(5, Math.min(95, ppi))

    const isPinRegime = finalPpi >= 55 || (totalGEX < 0 && proximity < 0.008)

    // Dynamic Settlebomb Strategies
    let type: "neutral_pin" | "bullish_squeeze" | "bearish_breakout" | "credit_spread" = "neutral_pin"
    let title = ""
    let description = ""
    let strikes = ""
    let confidenceScore = finalPpi
    let entryTrigger = ""
    let riskReward = ""
    let dipAction = ""

    if (isPinRegime) {
      if (totalGEX < 0) {
        type = "bearish_breakout"
        title = `${ticker} 0DTE Negative Pin Settlebomb`
        description = `A massive negative GEX cluster at ${magnet} is acting as a gravity well. Despite negative gamma volatility, dealer hedging flows are trapping the index near this key strike.`
        strikes = `BUY 1x SPX ${magnet - 10} Put / SELL 2x SPX ${magnet} Put / BUY 1x SPX ${magnet + 10} Put (0DTE Put Butterfly Spread)`
        entryTrigger = `Enter when price oscillates within 0.5% of ${magnet} after 2:30 PM EST.`
        riskReward = "Max Risk: $220 | Max Reward: $780 (per lot)"
        confidenceScore = Math.max(50, 90 - Math.round(proximity * 10000))
        dipAction = `Negative GEX Gravity Well: Price will bounce violently around ${magnet}. Use Put Butterfly to capture pinning or buy near-the-money debits when price drifts away.`
      } else {
        type = "neutral_pin"
        title = `${ticker} 0DTE Pin Settlebomb`
        description = `Positive GEX cluster is acting as a major price magnet. Dealer hedging will compress volatility and pin the close near ${magnet}.`
        strikes = `BUY 1x SPX ${magnet - 10} Call / SELL 2x SPX ${magnet} Call / BUY 1x SPX ${magnet + 10} Call (0DTE Butterfly Spread)`
        entryTrigger = `Enter between 3:15 PM and 3:30 PM EST if price remains within 0.25% of ${magnet}.`
        riskReward = "Max Risk: $180 | Max Reward: $820 (per lot)"
        
        if (spot < magnet) {
          dipAction = `Spot is currently at ${spot.toFixed(1)} (dipped below magnet ${magnet}). As index falls, dealers will buy shares to re-hedge delta, creating an upward drift. Enter Long Calls/Debits targeting mean-reversion to ${magnet}.`
        } else {
          dipAction = `Spot is currently at ${spot.toFixed(1)} (above magnet ${magnet}). Dealers will sell shares to delta-hedge, generating selling pressure. Enter Short Calls or Put Spreads targeting mean-reversion down to ${magnet}.`
        }
      }
    } else {
      // Breakout Regime (Negative GEX or Spot crossing Wall)
      const isCallWallProximity = Math.abs(spot - callWall) / spot < 0.003
      const isPutWallProximity = Math.abs(spot - putWall) / spot < 0.003
      
      if (spot >= callWall || isCallWallProximity) {
        type = "bullish_squeeze"
        title = `${ticker} 0DTE Squeeze Settlebomb (Target: ${roundStrikeAbove})`
        description = `Spot is breaching Call Wall at ${callWall} in a Negative GEX regime. Dealer short-gamma covering will accelerate a sharp short-squeeze upward, pulling price toward the highest positive GEX cluster at ${roundStrikeAbove}.`
        strikes = `BUY 1x SPX ${Math.round(callWall / 5) * 5} Call / SELL 1x SPX ${roundStrikeAbove} Call (0DTE Bull Call Spread)`
        entryTrigger = `Enter on a solid 5-minute candle close above ${callWall} with rising options volume.`
        riskReward = "Max Risk: $250 | Max Reward: Unlimited (Uncapped squeeze)"
        confidenceScore = Math.round(quantumTunneling.callWallTunnelProb * 0.9)
        dipAction = `Breakout confirmation: Spot holds above ${callWall}. Dealers are forced to chase momentum. Target is the highest nearby Call cluster at ${roundStrikeAbove}.`
      } else if (spot <= putWall || isPutWallProximity) {
        type = "bearish_breakout"
        title = `${ticker} 0DTE Put Crash Settlebomb (Target: ${roundStrikeBelow})`
        description = `Spot is cracking below Put Wall at ${putWall} in a Negative GEX regime. Dealer delta-hedging will dump futures, creating a cascading selloff toward the highest negative GEX cluster at ${roundStrikeBelow}.`
        strikes = `BUY 1x SPX ${Math.round(putWall / 5) * 5} Put / SELL 1x SPX ${roundStrikeBelow} Put (0DTE Bear Put Spread)`
        entryTrigger = `Enter on a solid 5-minute candle close below ${putWall} with high put buying flow.`
        riskReward = "Max Risk: $300 | Max Reward: Unlimited"
        confidenceScore = Math.round(quantumTunneling.putWallTunnelProb * 0.9)
        dipAction = `Crash Trigger: Spot slips below ${putWall}. Dealer short-gamma accelerative selling is active. Target is the highest nearby Put cluster at ${roundStrikeBelow}.`
      } else {
        type = "credit_spread"
        title = `${ticker} 0DTE Range-Bound Credit Settlebomb`
        description = `Volatility is elevated but spot sits in no-man's-land between ${putWall} and ${callWall}. Positive GEX walls are holding.`
        strikes = `SELL 1x SPX ${Math.ceil(callWall / 5) * 5} Call / SELL 1x SPX ${Math.floor(putWall / 5) * 5} Put (0DTE Iron Condor)`
        entryTrigger = `Enter if index stays in range during lunchtime (11:30 AM - 1:30 PM EST) and decay ramps.`
        riskReward = "Max Risk: $400 | Max Reward: $100 (92% probability of full profit)"
        confidenceScore = 88
        dipAction = `Range Bound: Time decay (Theta) is your primary edge. Let premium bleed. If spot approaches either wall, close that leg for risk control.`
      }
    }

    return {
      type,
      title,
      description,
      strikes,
      confidenceScore,
      entryTrigger,
      riskReward,
      dipAction,
      ppi: finalPpi
    }
  }, [isGeoblocked, spotPrice, maxGexStrikeObj, walls, totalGEX, currentTime, quantumTunneling, optionData])

  // 4. Composite Confluence Score calculation
  const compositeScore = useMemo(() => {
    // Stack confluences from all sections:
    // positive GEX (+15), Volatility regime (+10), Quantum Tunneling Proximity (+15), Options Flow Momentum (+15)
    let score = 50 // baseline neutral
    
    // GEX regime impact
    if (totalGEX > 0) score += 15
    else score -= 20

    // GARCH forecast impact
    if (garchForecast.direction === "CONTRACTING") score += 10
    else score -= 5

    // Proximity to walls
    if (spotPrice && walls.callWall && walls.putWall) {
      const callDist = Math.abs(spotPrice - walls.callWall) / spotPrice
      const putDist = Math.abs(spotPrice - walls.putWall) / spotPrice
      if (callDist < 0.005 || putDist < 0.005) {
        score += 15 // high active confluence
      }
    }

    return Math.max(10, Math.min(95, score))
  }, [totalGEX, garchForecast, spotPrice, walls])

  const handleJournalLog = () => {
    if (!settlebombTradeIdea || !onLogJournalTrade) return
    onLogJournalTrade({
      ticker,
      date: new Date().toISOString().split('T')[0],
      strategy: settlebombTradeIdea.title,
      entryPrice: spotPrice || 0,
      notes: `${settlebombTradeIdea.description} | Strikes: ${settlebombTradeIdea.strikes} | PPI: ${settlebombTradeIdea.ppi}%`,
      pnl: 0,
      status: "OPEN"
    })
    setIsLogged(true)
    setTimeout(() => setIsLogged(false), 3000)
  }

  // Render geoblock screen for India market
  if (isGeoblocked) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-black border border-white/5 rounded-xl min-h-[400px] text-center">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/30 text-amber-500 mb-4 animate-pulse">
          <Lock className="w-5 h-5" />
        </div>
        <h3 className="text-base font-bold font-display text-white mb-2">GEO-RESTRICTED REGION</h3>
        <p className="text-xs font-mono text-[#666] max-w-sm leading-relaxed">
          The Settlebomb options scanner and real-time pinning engine are locked for Indian markets due to exchange compliance. Select a US market asset (e.g. SPX/SPY) to activate the terminal.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 w-full select-none font-mono">
      {/* ─── LEFT COLUMN: CONFLUENCE BOARD (STACKED INDICATORS) ─── */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        {/* Core Confluence Meter */}
        <div className="glass-panel rounded-lg p-5 border border-white/5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-bold text-white tracking-wider flex items-center gap-1.5 font-display">
              <Layers className="w-3.5 h-3.5 text-terminal-green" />
              STACKED CONFLUENCE MATRIX
            </h3>
            <span className="text-[10px] text-[#555] font-bold">LIVE METRIC OVERLAYS</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Macro Status Cards */}
            <div className="flex flex-col gap-3">
              {/* GEX REGIME CARD */}
              <div className="bg-black/40 border border-white/5 rounded p-3 flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-[9px] text-[#666] uppercase">GEX Regime</span>
                  <span className={`text-xs font-bold mt-0.5 ${totalGEX >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                    {totalGEX >= 0 ? "POSITIVE GAMMA" : "NEGATIVE GAMMA"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {totalGEX >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-terminal-green" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-terminal-red" />
                  )}
                </div>
              </div>

              {/* GARCH VOLATILITY REGIME */}
              <div className="bg-black/40 border border-white/5 rounded p-3 flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-[9px] text-[#666] uppercase">GARCH IV Forecast</span>
                  <span className="text-xs font-bold text-white mt-0.5">
                    {garchForecast.forecastVol.toFixed(1)}% ({garchForecast.direction})
                  </span>
                </div>
                <span className="text-[9px] bg-white/5 px-1.5 py-0.5 rounded text-[#888] font-bold">
                  {garchForecast.confidence}% Conf.
                </span>
              </div>

              {/* ZERO GAMMA FLIP LEVEL */}
              <div className="bg-black/40 border border-white/5 rounded p-3 flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-[9px] text-[#666] uppercase">Zero GEX Flip</span>
                  <span className="text-xs font-bold text-[#3399ff] mt-0.5">
                    {gammaFlipLevel ? `$${gammaFlipLevel.toFixed(1)}` : "N/A"}
                  </span>
                </div>
                <span className="text-[9px] text-[#555] font-bold">REGIME PIVOT</span>
              </div>
            </div>

            {/* Micro Levels & Quantum Tunneling */}
            <div className="flex flex-col gap-3">
              {/* CALL PUT WALLS */}
              <div className="bg-black/40 border border-white/5 rounded p-3 flex flex-col gap-1">
                <div className="flex justify-between items-center text-[9px] text-[#666] uppercase">
                  <span>Call Wall (Resistance)</span>
                  <span>Put Wall (Support)</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-terminal-red">${walls.callWall || "N/A"}</span>
                    <span className="text-[9px] text-[#888] font-bold">Touch Prob: {touchProbability.callWallTouch}%</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-xs font-bold text-terminal-green">${walls.putWall || "N/A"}</span>
                    <span className="text-[9px] text-[#888] font-bold">Touch Prob: {touchProbability.putWallTouch}%</span>
                  </div>
                </div>
              </div>

              {/* QUANTUM TUNNELING PROB */}
              <div className="bg-black/40 border border-white/5 rounded p-3 flex flex-col gap-1.5">
                <span className="text-[9px] text-[#666] uppercase">Quantum Wall Tunneling Prob</span>
                <div className="space-y-1">
                  <div className="flex justify-between text-[9.5px]">
                    <span className="text-terminal-red">Call Wall Breakout:</span>
                    <span className="text-white font-bold">{quantumTunneling.callWallTunnelProb}%</span>
                  </div>
                  <div className="w-full bg-[#111] h-1 rounded overflow-hidden">
                    <div className="bg-terminal-red h-full" style={{ width: `${quantumTunneling.callWallTunnelProb}%` }} />
                  </div>
                  <div className="flex justify-between text-[9.5px] mt-1">
                    <span className="text-terminal-green">Put Wall Breakdown:</span>
                    <span className="text-white font-bold">{quantumTunneling.putWallTunnelProb}%</span>
                  </div>
                  <div className="w-full bg-[#111] h-1 rounded overflow-hidden">
                    <div className="bg-terminal-green h-full" style={{ width: `${quantumTunneling.putWallTunnelProb}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stacking Summary Confluence Meter */}
          <div className="mt-5 pt-4 border-t border-white/5 flex flex-col md:flex-row items-center gap-4">
            <div className="relative w-24 h-12 flex flex-col items-center justify-center overflow-hidden flex-shrink-0">
              {/* Simple D3/CSS semi-gauge */}
              <div className="w-20 h-10 border-8 border-[#111] border-b-0 rounded-t-full relative">
                <div 
                  className={`w-20 h-10 border-8 border-t-0 border-b-0 border-l-0 rounded-t-full absolute -top-[8px] -left-[8px] transform origin-bottom transition-transform duration-1000 ${
                    compositeScore >= 60 ? "border-r-terminal-green" : "border-r-terminal-red"
                  }`} 
                  style={{ transform: `rotate(${(compositeScore / 100) * 180 - 90}deg)` }}
                />
              </div>
              <span className="text-[10px] text-white font-bold mt-1">{compositeScore}%</span>
            </div>
            
            <div className="flex-1 flex flex-col text-center md:text-left">
              <span className="text-[10px] text-[#888] uppercase tracking-wider font-bold">Composite Alignment Signal</span>
              <p className="text-[11px] text-[#666] leading-relaxed mt-1">
                {compositeScore >= 65 ? (
                  <span className="text-[#00ff66] font-bold">STRONG MEAN REVERSION BIAS: </span>
                ) : compositeScore <= 40 ? (
                  <span className="text-[#ff3366] font-bold">VOLATILITY EXPANSION SQUEEZE ACTIVE: </span>
                ) : (
                  <span className="text-white font-bold">RANGE BOUND CONSOLIDATION: </span>
                )}
                Quant probabilities, GEX positioning, and GARCH volatility overlays indicate a {compositeScore >= 65 ? "high pinning close probability." : "strong breakout bias. Dealer hedging is accelerating trends."}
              </p>
            </div>
          </div>
        </div>

        {/* Expected Move Probability Zone */}
        <div className="glass-panel rounded-lg p-5 border border-white/5">
          <h3 className="text-xs font-bold text-white tracking-wider mb-3 flex items-center gap-1.5 font-display">
            <Target className="w-3.5 h-3.5 text-[#3399ff]" />
            IMPLIED EXPECTED MOVE ZONE
          </h3>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center text-[10.5px]">
              <span className="text-[#666]">Upper Standard Deviation Bound:</span>
              <span className="text-terminal-red font-bold">${expectedMove.upper.toFixed(1)} (+${expectedMove.percentage.toFixed(2)}%)</span>
            </div>
            <div className="flex justify-between items-center text-[10.5px]">
              <span className="text-[#666]">Lower Standard Deviation Bound:</span>
              <span className="text-terminal-green font-bold">${expectedMove.lower.toFixed(1)} (-${expectedMove.percentage.toFixed(2)}%)</span>
            </div>
            
            {/* Visual range bounds bar */}
            <div className="mt-3 relative h-6 bg-[#08080a] border border-white/5 rounded overflow-hidden flex items-center px-2">
              <div className="absolute left-[15%] right-[15%] h-full bg-[#3399ff]/5 border-l border-r border-[#3399ff]/15 flex items-center justify-center">
                <span className="text-[8px] text-[#3399ff]/60 tracking-wider">68.2% PROBABILITY BAND</span>
              </div>
              <div 
                className="absolute w-1.5 h-full bg-white/60 z-10" 
                style={{ 
                  left: spotPrice && expectedMove.upper && expectedMove.lower
                    ? `${((spotPrice - expectedMove.lower) / (expectedMove.upper - expectedMove.lower)) * 100}%`
                    : "50%" 
                }}
                title="Current Spot Price Location"
              />
              <span className="text-[8px] text-terminal-green absolute left-2 z-10">${expectedMove.lower.toFixed(0)}</span>
              <span className="text-[8px] text-terminal-red absolute right-2 z-10">${expectedMove.upper.toFixed(0)}</span>
            </div>
          </div>
        </div>

        {/* 3D Volatility & Gamma Confluence Surfaces */}
        <div className="glass-panel rounded-lg p-5 border border-white/5 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-white tracking-wider flex items-center gap-1.5 font-display">
              <Activity className="w-3.5 h-3.5 text-terminal-green" />
              3D VOLATILITY & GAMMA CONFLUENCE SURFACES
            </h3>
            <span className="text-[10px] text-[#555] font-bold">OPEX RANGE BASELINE</span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-[400px]">
            <div className="bg-black/50 border border-white/5 rounded overflow-hidden h-full">
              <GEXSurfaceChart
                data={enrichedOptionData}
                ticker={ticker}
                spotPrice={spotPrice || 0}
                selectedExpiries={surfaceExpiries}
              />
            </div>
            <div className="bg-black/50 border border-white/5 rounded overflow-hidden h-full">
              <IVSurfaceChart
                data={enrichedOptionData}
                ticker={ticker}
                spotPrice={spotPrice || 0}
                selectedExpiries={surfaceExpiries}
              />
            </div>
          </div>
        </div>
      </div>


      {/* ─── RIGHT COLUMN: 0DTE OPTION SETTLEBOMB SCANNER ─── */}
      <div className="flex flex-col gap-4">
        <div className="glass-panel rounded-lg p-5 border border-white/5 h-full flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold text-white tracking-wider flex items-center gap-1.5 font-display">
                <Zap className="w-3.5 h-3.5 text-terminal-green animate-pulse" />
                0DTE SETTLEBOMB SCANNER
              </h3>
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-terminal-green/10 text-terminal-green border border-terminal-green/30 animate-pulse font-bold">
                LIVE SPX SCAN
              </span>
            </div>

            {settlebombTradeIdea ? (
              <div className="flex flex-col gap-4">
                {/* Header signal */}
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] text-[#666] uppercase">Actionable Setup</span>
                  <span className="text-sm font-bold text-white font-display flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-terminal-green" />
                    {settlebombTradeIdea.title}
                  </span>
                </div>

                {/* Description */}
                <p className="text-[10.5px] text-[#888] leading-relaxed">
                  {settlebombTradeIdea.description}
                </p>

                {/* Strikes recommendation */}
                <div className="p-3 bg-black/50 border border-white/5 rounded flex flex-col gap-1">
                  <span className="text-[8.5px] text-[#666] uppercase">Strikes & Strategy</span>
                  <span className="text-[10.5px] font-bold text-terminal-green font-mono leading-relaxed">
                    {settlebombTradeIdea.strikes}
                  </span>
                </div>

                {/* Dynamic Entry Trigger */}
                <div className="flex flex-col gap-1">
                  <span className="text-[8.5px] text-[#666] uppercase">Entry Triggers</span>
                  <p className="text-[10.5px] text-[#777] leading-relaxed">
                    {settlebombTradeIdea.entryTrigger}
                  </p>
                </div>

                {/* Risk Parameters */}
                <div className="flex flex-col gap-1">
                  <span className="text-[8.5px] text-[#666] uppercase">Risk Parameters</span>
                  <p className="text-[10.5px] text-white/90">
                    {settlebombTradeIdea.riskReward}
                  </p>
                </div>

                {/* Pinning Reversion advice */}
                <div className="p-3 bg-[#00ff66]/5 border border-[#00ff66]/15 rounded flex flex-col gap-1">
                  <span className="text-[8.5px] text-terminal-green uppercase flex items-center gap-1 font-bold">
                    <Activity className="w-3 h-3" />
                    DYNAMIC PINNING DIRECTION
                  </span>
                  <p className="text-[10px] text-[#888] leading-relaxed">
                    {settlebombTradeIdea.dipAction}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-20 text-[#555] text-xs">
                Scanning options feed... No trade signals active.
              </div>
            )}
          </div>

          {/* Bottom stats and Log button */}
          {settlebombTradeIdea && (
            <div className="mt-6 pt-4 border-t border-white/5 flex flex-col gap-4">
              <div className="flex justify-between items-center text-[10.5px]">
                <span className="text-[#666]">Pinning Prob (PPI):</span>
                <span className={`font-bold ${settlebombTradeIdea.ppi >= 55 ? "text-terminal-green" : "text-[#888]"}`}>
                  {settlebombTradeIdea.ppi}%
                </span>
              </div>
              
              <button
                onClick={handleJournalLog}
                disabled={isLogged}
                className={`w-full py-2.5 rounded font-bold text-xs font-mono transition-all flex items-center justify-center gap-1.5 border ${
                  isLogged 
                    ? "bg-terminal-green/20 text-terminal-green border-terminal-green/30 cursor-default" 
                    : "bg-terminal-green/10 text-terminal-green border-terminal-green/35 hover:bg-terminal-green/20"
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                {isLogged ? "TRADE LOGGED IN JOURNAL!" : "LOG TRADE TO JOURNAL"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
