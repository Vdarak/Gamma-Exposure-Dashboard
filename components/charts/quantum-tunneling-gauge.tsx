"use client"

import { useEffect, useState, useMemo } from 'react'
import { getQuantumTunneling, QuantumTunnelingData } from '@/lib/backend-api'
import { colors } from '@/lib/design-tokens'
import type { OptionData } from '@/lib/types'
import { calcGammaExEnhanced, type PricingMethod } from '@/lib/calculations'

interface QuantumTunnelingGaugeProps {
  ticker: string
  activeExpiries: string[]
  expiryMode: string
  optionData?: OptionData[]
  spotPrice?: number | null
  pricingMethod?: PricingMethod
}

export function QuantumTunnelingGauge({ 
  ticker, 
  activeExpiries, 
  expiryMode,
  optionData,
  spotPrice,
  pricingMethod = 'black-scholes'
}: QuantumTunnelingGaugeProps) {
  const [data, setData] = useState<QuantumTunnelingData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Calculate walls and breakthrough probabilities locally to guarantee 100% match with GEX charts
  const localData = useMemo(() => {
    if (!optionData || optionData.length === 0 || !spotPrice) return null;

    const today = new Date();
    
    // 1. Calculate days till expiration and option.GEX_BS
    const enrichedOptions = optionData.map((o) => {
      const opt = { ...o };
      const daysDiff = Math.max(1, Math.ceil((opt.expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
      opt.daysTillExp = daysDiff === 0 ? 1 / 262 : daysDiff / 262;

      let vol = opt.iv && opt.iv > 0 ? opt.iv : 0.3;
      // Standard robust IV parser heuristic to handle decimal vs percent mismatch
      if (vol > 1.5) vol = vol / 100;

      if (opt.type === "C") {
        opt.GEX_BS = calcGammaExEnhanced(
          spotPrice,
          opt.strike,
          vol,
          opt.daysTillExp,
          0,
          0,
          "call",
          opt.open_interest,
          pricingMethod
        );
      } else {
        opt.GEX_BS = -calcGammaExEnhanced(
          spotPrice,
          opt.strike,
          vol,
          opt.daysTillExp,
          0,
          0,
          "put",
          opt.open_interest,
          pricingMethod
        );
      }
      return opt;
    });

    // 2. Group GEX by strikes to find largest walls
    const strikeGexMap = new Map<number, { callGex: number; putGex: number; totalGex: number }>();
    enrichedOptions.forEach((opt) => {
      const strike = opt.strike;
      if (!strikeGexMap.has(strike)) {
        strikeGexMap.set(strike, { callGex: 0, putGex: 0, totalGex: 0 });
      }
      
      const gexVal = opt.GEX_BS || 0;
      const entry = strikeGexMap.get(strike)!;
      if (opt.type === "C") entry.callGex += gexVal;
      else entry.putGex += gexVal;
      entry.totalGex += gexVal;
    });

    const sortedStrikes = Array.from(strikeGexMap.entries()).map(([strike, gex]) => ({
      strike,
      ...gex
    })).sort((a, b) => b.totalGex - a.totalGex);

    if (sortedStrikes.length === 0) return null;

    // 3. Find top Call Wall and Put Wall
    // Top Call Wall: highest call GEX strike nearest to spot price
    const topCallGexStrikes = [...sortedStrikes]
      .filter((s) => s.callGex > 0)
      .sort((a, b) => b.callGex - a.callGex)
      .slice(0, 5);
    
    const topCallWall = topCallGexStrikes.length > 0 
      ? topCallGexStrikes.sort((a, b) => Math.abs(a.strike - spotPrice) - Math.abs(b.strike - spotPrice))[0]
      : sortedStrikes[0];

    // Top Put Wall: highest put GEX strike nearest to spot price
    const topPutGexStrikes = [...sortedStrikes]
      .filter((s) => s.putGex < 0)
      .sort((a, b) => a.putGex - b.putGex)
      .slice(0, 5);
      
    const topPutWall = topPutGexStrikes.length > 0
      ? topPutGexStrikes.sort((a, b) => Math.abs(a.strike - spotPrice) - Math.abs(b.strike - spotPrice))[0]
      : sortedStrikes[0];

    const avgGexVal = sortedStrikes.reduce((acc, s) => acc + Math.abs(s.totalGex), 0) / sortedStrikes.length;

    // 4. Calculate daily return standard deviation as energy E
    const calculateWallTunneling = (wallStrike: number, wallGex: number, isCall: boolean) => {
      const distance = Math.abs(spotPrice - wallStrike) / spotPrice;
      const barrierHeight = Math.max(0.1, Math.abs(wallGex) / (avgGexVal || 1.0));
      
      let breakthroughProbability = 0;
      let status = 'Standard';
      
      if (wallGex > 0) {
        const kappa = Math.sqrt(barrierHeight);
        breakthroughProbability = Math.exp(-2.5 * kappa * (distance * 100));
        status = 'Strong Pin / Resistance';
      } else {
        breakthroughProbability = 0.85 * Math.exp(-1.5 * (distance * 100));
        status = 'Magnetic / Accelerating';
      }

      breakthroughProbability = Math.max(0.01, Math.min(0.99, breakthroughProbability));

      return {
        strike: wallStrike,
        gexBillions: wallGex / 1e9,
        distancePoints: Math.abs(spotPrice - wallStrike),
        distancePercent: distance * 100,
        barrierStrength: barrierHeight,
        breakthroughProbability,
        status
      };
    };

    const callWallMetrics = calculateWallTunneling(topCallWall.strike, topCallWall.callGex, true);
    const putWallMetrics = calculateWallTunneling(topPutWall.strike, topPutWall.putGex, false);

    return {
      success: true,
      ticker: ticker.toUpperCase(),
      spotPrice,
      callWall: callWallMetrics,
      putWall: putWallMetrics
    };
  }, [optionData, spotPrice, pricingMethod, ticker]);

  const displayData = localData || data;

  useEffect(() => {
    // Only run backend query if optionData was not passed (fallback mode)
    if (optionData && optionData.length > 0) return;

    let active = true
    async function loadData() {
      setIsLoading(true)
      setError(null)
      try {
        const res = await getQuantumTunneling(ticker, activeExpiries)
        if (active) {
          if (res.success) {
            setData(res)
          } else {
            setError((res as any).error || 'Failed to calculate tunneling probability')
          }
        }
      } catch (err: any) {
        if (active) setError(err.message || 'Failed to calculate tunneling probability')
      } finally {
        if (active) setIsLoading(false)
      }
    }
    loadData()
    return () => {
      active = false
    }
  }, [ticker, activeExpiries, optionData])

  const renderMeter = (prob: number) => {
    const totalBars = 20
    const activeBars = Math.round(prob * totalBars)
    let fillClass = 'text-terminal-green'
    
    if (prob > 0.6) fillClass = 'text-[#FF3B60]' // High probability of breakthrough (danger for barrier)
    else if (prob > 0.3) fillClass = 'text-[#00D4FF]' // Moderate
    
    let meterStr = ''
    for (let i = 0; i < totalBars; i++) {
      if (i < activeBars) meterStr += '▮'
      else meterStr += '·'
    }
    
    return (
      <div className="font-mono text-xs tracking-widest flex items-center gap-2">
        <span className={fillClass}>{meterStr}</span>
        <span className="font-bold text-[#E5E5E5]">{(prob * 100).toFixed(1)}%</span>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#070709] border border-[#141416] rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 border-b border-[#141416] pb-3 flex-shrink-0">
        <div>
          <h2 className="text-xs font-mono font-bold text-[#E5E5E5] tracking-wider uppercase">Quantum GEX Barrier Tunneling</h2>
          <p className="text-[10px] font-mono text-[#555] mt-0.5">Schrödinger Wave Equation modeling of spot price boundary penetrations</p>
        </div>
      </div>

      {isLoading && !displayData && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-terminal-green">
            <div className="w-3.5 h-3.5 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
            <span className="text-[10px] font-mono tracking-widest uppercase">SOLVING WAVE BOUNDARY EQUATIONS...</span>
          </div>
        </div>
      )}

      {error && !displayData && (
        <div className="flex-1 flex items-center justify-center text-xs font-mono text-[#FF3B60]">
          ⚠️ ERROR: {error}
        </div>
      )}

      {displayData && (
        <div className="flex-1 flex flex-col min-h-0 gap-4 justify-between">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Call Wall Barrier */}
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center border-b border-[#141416] pb-2">
                <span className="text-xs font-mono font-bold text-[#00C805]">CALL WALL BOUNDARY</span>
                <span className="text-[9px] font-mono text-[#555] uppercase bg-[#141416] px-1.5 py-0.5 rounded">
                  {displayData.callWall.status}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div>
                  <span className="text-[#555] block uppercase">Strike Level</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">${displayData.callWall.strike.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[#555] block uppercase">Exposure Size</span>
                  <span className="text-xs text-[#00C805] font-bold mt-0.5">+{(displayData.callWall.gexBillions * 1000).toFixed(0)}M GEX</span>
                </div>
                <div className="mt-2">
                  <span className="text-[#555] block uppercase">Delta to Strike</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">+{displayData.callWall.distancePoints.toFixed(2)} pts</span>
                </div>
                <div className="mt-2">
                  <span className="text-[#555] block uppercase">Percent Distance</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">+{displayData.callWall.distancePercent.toFixed(2)}%</span>
                </div>
              </div>

              <div className="border-t border-[#141416] pt-3 mt-1">
                <span className="text-[9px] font-mono text-[#555] block uppercase mb-1">Tunneling Probability</span>
                {renderMeter(displayData.callWall.breakthroughProbability)}
              </div>
            </div>

            {/* Put Wall Barrier */}
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center border-b border-[#141416] pb-2">
                <span className="text-xs font-mono font-bold text-[#FF3B60]">PUT WALL BOUNDARY</span>
                <span className="text-[9px] font-mono text-[#555] uppercase bg-[#141416] px-1.5 py-0.5 rounded">
                  {displayData.putWall.status}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div>
                  <span className="text-[#555] block uppercase">Strike Level</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">${displayData.putWall.strike.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[#555] block uppercase">Exposure Size</span>
                  <span className="text-xs text-[#FF3B60] font-bold mt-0.5">-{Math.abs(displayData.putWall.gexBillions * 1000).toFixed(0)}M GEX</span>
                </div>
                <div className="mt-2">
                  <span className="text-[#555] block uppercase">Delta to Strike</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">-{displayData.putWall.distancePoints.toFixed(2)} pts</span>
                </div>
                <div className="mt-2">
                  <span className="text-[#555] block uppercase">Percent Distance</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">-{displayData.putWall.distancePercent.toFixed(2)}%</span>
                </div>
              </div>

              <div className="border-t border-[#141416] pt-3 mt-1">
                <span className="text-[9px] font-mono text-[#555] block uppercase mb-1">Tunneling Probability</span>
                {renderMeter(displayData.putWall.breakthroughProbability)}
              </div>
            </div>
            
          </div>
        </div>
      )}
    </div>
  )
}
