"use client"

import { useMemo } from "react"

// ─── Minimal arc gauge for terminal UI ───────────────────────────

interface GaugeProps {
  value: number
  min: number
  max: number
  label: string
  unit?: string
  color: string        // e.g. '#00FF88'
  colorMuted: string   // e.g. 'rgba(0, 255, 136, 0.12)'
}

function TerminalGauge({ value, min, max, label, unit = '', color, colorMuted }: GaugeProps) {
  const normalized = Math.max(0, Math.min(1, (value - min) / (max - min || 1)))
  const sweepAngle = 180
  const startAngle = 180  // left
  const endAngle = startAngle + sweepAngle * normalized

  // SVG arc path
  const radius = 36
  const cx = 44
  const cy = 44
  const strokeWidth = 4

  const polarToCartesian = (angle: number) => {
    const rad = (angle * Math.PI) / 180
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    }
  }

  const trackStart = polarToCartesian(180)
  const trackEnd = polarToCartesian(360)
  const arcEnd = polarToCartesian(endAngle)
  const trackPath = `M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 0 1 ${trackEnd.x} ${trackEnd.y}`
  const valuePath = normalized > 0.01
    ? `M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 0 1 ${arcEnd.x} ${arcEnd.y}`
    : ''

  // Needle
  const needleAngle = 180 + sweepAngle * normalized
  const needleRad = (needleAngle * Math.PI) / 180
  const needleLen = radius - 8
  const needleEnd = {
    x: cx + needleLen * Math.cos(needleRad),
    y: cy + needleLen * Math.sin(needleRad),
  }

  const formatValue = (v: number) => {
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`
    return v.toFixed(2)
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="88" height="52" viewBox="0 0 88 52" className="overflow-visible">
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="#1A1A1A"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Value arc */}
        {valuePath && (
          <path
            d={valuePath}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color}40)` }}
          />
        )}
        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needleEnd.x}
          y2={needleEnd.y}
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 3px ${color}60)` }}
        />
        {/* Center dot */}
        <circle cx={cx} cy={cy} r={2} fill={color} />
      </svg>

      {/* Value */}
      <span className="font-mono text-sm font-semibold" style={{ color }}>
        {formatValue(value)}{unit}
      </span>

      {/* Label */}
      <span className="text-xxs text-[#525252] font-medium uppercase tracking-wider">
        {label}
      </span>
    </div>
  )
}

// ─── Stat Bar ─────────────────────────────────────────────────────

interface StatBarProps {
  spotPrice: number | null
  totalGEX: number
  optionData: Array<{
    gamma: number
    open_interest: number
    type: string
    iv: number
    GEX?: number
    GEX_BS?: number
  }>
  market: 'USA' | 'INDIA'
  gammaFlipLevel: number | null
}

export function StatBar({ spotPrice, totalGEX, optionData, market, gammaFlipLevel }: StatBarProps) {
  const currencySymbol = market === 'INDIA' ? '₹' : '$'

  // Compute aggregate stats
  const stats = useMemo(() => {
    let totalGamma = 0
    let netGamma = 0
    let weightedIV = 0
    let totalAbsGEX = 0

    optionData.forEach((opt) => {
      const gamma = opt.gamma || 0
      const oi = opt.open_interest || 0
      const gexValue = opt.GEX_BS || opt.GEX || gamma * oi * 100
      const absGEX = Math.abs(gexValue)

      totalGamma += gamma * oi * 100
      netGamma += opt.type === 'C' ? gamma * oi * 100 : -(gamma * oi * 100)
      weightedIV += (opt.iv || 0) * absGEX
      totalAbsGEX += absGEX
    })

    const gexWeightedVol = totalAbsGEX > 0 ? (weightedIV / totalAbsGEX) * 100 : 0

    return { totalGamma, netGamma, gexWeightedVol }
  }, [optionData])

  // Dynamic gauge ranges
  const gexMax = Math.max(Math.abs(totalGEX) * 2, 0.5)
  const volMax = Math.max(stats.gexWeightedVol * 1.5, 50)

  return (
    <div className="border-b border-[#1A1A1A] bg-[#0A0A0A]">
      <div className="px-4 lg:px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Numeric stats */}
          <div className="flex items-center gap-6">
            <StatCell
              label="TOTAL Γ"
              value={formatLargeNumber(stats.totalGamma)}
            />
            <Divider />
            <StatCell
              label="NET Γ"
              value={formatLargeNumber(stats.netGamma)}
              color={stats.netGamma >= 0 ? '#00FF88' : '#FF3B3B'}
            />
            <Divider />
            <StatCell
              label="Γ FLIP"
              value={gammaFlipLevel ? `${currencySymbol}${gammaFlipLevel.toFixed(0)}` : '—'}
              color="#FF00AA"
            />
          </div>

          {/* Right: Gauges */}
          <div className="flex items-center gap-6">
            <TerminalGauge
              value={totalGEX}
              min={-gexMax}
              max={gexMax}
              label="GEX Intensity"
              unit="B"
              color={totalGEX >= 0 ? '#00FF88' : '#FF3B3B'}
              colorMuted={totalGEX >= 0 ? 'rgba(0, 255, 136, 0.12)' : 'rgba(255, 59, 59, 0.12)'}
            />
            <TerminalGauge
              value={stats.gexWeightedVol}
              min={0}
              max={volMax}
              label="GEX Wtd Vol"
              color="#FF3B3B"
              colorMuted="rgba(255, 59, 59, 0.12)"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xxs text-[#525252] font-medium uppercase tracking-wider">{label}</span>
      <span
        className="font-mono text-sm font-semibold"
        style={{ color: color || '#E5E5E5' }}
      >
        {value}
      </span>
    </div>
  )
}

function Divider() {
  return <div className="w-px h-8 bg-[#1A1A1A]" />
}

function formatLargeNumber(n: number): string {
  const abs = Math.abs(n)
  const sign = n >= 0 ? '+' : '-'
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`
  return `${sign}${abs.toFixed(0)}`
}
