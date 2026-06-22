"use client"

import { useEffect, useState } from 'react'
import { getQuantumTunneling, QuantumTunnelingData } from '@/lib/backend-api'
import { colors } from '@/lib/design-tokens'

interface QuantumTunnelingGaugeProps {
  ticker: string
  activeExpiries: string[]
  expiryMode: string
}

export function QuantumTunnelingGauge({ ticker, activeExpiries, expiryMode }: QuantumTunnelingGaugeProps) {
  const [data, setData] = useState<QuantumTunnelingData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
  }, [ticker, activeExpiries])

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

      {isLoading && !data && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-terminal-green">
            <div className="w-3.5 h-3.5 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
            <span className="text-[10px] font-mono tracking-widest uppercase">SOLVING WAVE BOUNDARY EQUATIONS...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex-1 flex items-center justify-center text-xs font-mono text-[#FF3B60]">
          ⚠️ ERROR: {error}
        </div>
      )}

      {data && (
        <div className="flex-1 flex flex-col min-h-0 gap-4 justify-between">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Call Wall Barrier */}
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center border-b border-[#141416] pb-2">
                <span className="text-xs font-mono font-bold text-[#00C805]">CALL WALL BOUNDARY</span>
                <span className="text-[9px] font-mono text-[#555] uppercase bg-[#141416] px-1.5 py-0.5 rounded">
                  {data.callWall.status}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div>
                  <span className="text-[#555] block uppercase">Strike Level</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">${data.callWall.strike.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[#555] block uppercase">Exposure Size</span>
                  <span className="text-xs text-[#00C805] font-bold mt-0.5">+{data.callWall.gexBillions.toFixed(2)} Bn GEX</span>
                </div>
                <div className="mt-2">
                  <span className="text-[#555] block uppercase">Delta to Strike</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">+{data.callWall.distancePoints.toFixed(2)} pts</span>
                </div>
                <div className="mt-2">
                  <span className="text-[#555] block uppercase">Percent Distance</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">+{data.callWall.distancePercent.toFixed(2)}%</span>
                </div>
              </div>

              <div className="border-t border-[#141416] pt-3 mt-1">
                <span className="text-[9px] font-mono text-[#555] block uppercase mb-1">Tunneling Probability</span>
                {renderMeter(data.callWall.breakthroughProbability)}
              </div>
            </div>

            {/* Put Wall Barrier */}
            <div className="bg-[#0A0A0C] border border-[#141416] rounded p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center border-b border-[#141416] pb-2">
                <span className="text-xs font-mono font-bold text-[#FF3B60]">PUT WALL BOUNDARY</span>
                <span className="text-[9px] font-mono text-[#555] uppercase bg-[#141416] px-1.5 py-0.5 rounded">
                  {data.putWall.status}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div>
                  <span className="text-[#555] block uppercase">Strike Level</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">${data.putWall.strike.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[#555] block uppercase">Exposure Size</span>
                  <span className="text-xs text-[#FF3B60] font-bold mt-0.5">-{Math.abs(data.putWall.gexBillions).toFixed(2)} Bn GEX</span>
                </div>
                <div className="mt-2">
                  <span className="text-[#555] block uppercase">Delta to Strike</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">-{data.putWall.distancePoints.toFixed(2)} pts</span>
                </div>
                <div className="mt-2">
                  <span className="text-[#555] block uppercase">Percent Distance</span>
                  <span className="text-xs text-[#E5E5E5] font-bold mt-0.5">-{data.putWall.distancePercent.toFixed(2)}%</span>
                </div>
              </div>

              <div className="border-t border-[#141416] pt-3 mt-1">
                <span className="text-[9px] font-mono text-[#555] block uppercase mb-1">Tunneling Probability</span>
                {renderMeter(data.putWall.breakthroughProbability)}
              </div>
            </div>
            
          </div>

          {/* Theoretical explanation footer */}
          <div className="bg-[#0A0A0C] border border-[#141416] rounded p-4 text-[10px] font-mono text-[#777] leading-relaxed flex flex-col gap-3">
            <div>
              <span className="text-[#00D4FF] font-bold uppercase block mb-1">⚛️ Schrödinger Barrier Wave Equations</span>
              <p className="mb-2">
                We model price boundaries as potential energy barriers $U(x)$. The transmission probability $T$ represents the probability of the spot price "tunneling" through major dealer open interest walls:
              </p>
              <div className="bg-black/40 border border-[#141416] rounded p-2.5 my-2 text-center text-[#E5E5E5] flex flex-col items-center gap-1.5 font-sans">
                <div className="flex flex-col items-center">
                  <span className="text-xs font-mono font-semibold text-[#00C805]">Calls (Positive GEX Barrier):</span>
                  <span className="font-mono text-[11px] text-gray-400">P(Breakthrough) = e<sup>-2.5 · √U · d</sup></span>
                </div>
                <div className="flex flex-col items-center mt-1">
                  <span className="text-xs font-mono font-semibold text-[#FF3B60]">Puts (Negative GEX Vacuum):</span>
                  <span className="font-mono text-[11px] text-gray-400">P(Breakthrough) = 0.85 · e<sup>-1.5 · d</sup></span>
                </div>
                <span className="text-[9px] text-[#555] font-mono mt-1">U = Barrier Strength (GEX / Avg GEX) | d = % Distance to Strike</span>
              </div>
            </div>
            <div className="border-t border-[#141416] pt-2 flex flex-col gap-1.5">
              <span className="text-[#B5B5B5] font-semibold uppercase block">Selected Expiries Context:</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                <span className="bg-[#141416] text-[#E5E5E5] border border-[#222] px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">
                  Mode: {expiryMode}
                </span>
                {activeExpiries.slice(0, 5).map(exp => (
                  <span key={exp} className="bg-black text-terminal-green border border-terminal-green/20 px-2 py-0.5 rounded text-[9px]">
                    {exp}
                  </span>
                ))}
                {activeExpiries.length > 5 && (
                  <span className="bg-black text-[#555] border border-[#141416] px-2 py-0.5 rounded text-[9px]">
                    +{activeExpiries.length - 5} more
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
