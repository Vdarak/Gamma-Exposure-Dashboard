"use client"

import { useMemo, useState } from "react"
import { Bar } from "react-chartjs-2"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js"

import type { OptionData } from "@/lib/types"
import { computeGEXByStrike, computeVolumeByStrike, findZeroGammaLevel, type PricingMethod } from "@/lib/calculations"
import { colors, chartTheme, typography } from "@/lib/design-tokens"
import { createHorizontalBarOptions, getGEXBarColors } from "@/lib/chart-config"
import { PricingMethodToggle } from "../pricing-method-toggle"

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

interface GEXByStrikeChartProps {
  data: OptionData[]
  ticker: string
  spotPrice: number
  selectedExpiry: string
  pricingMethod: PricingMethod
  onPricingMethodChange: (method: PricingMethod) => void
  market?: 'USA' | 'INDIA'
}

export function GEXByStrikeChart({ data, ticker, spotPrice, selectedExpiry, pricingMethod, onPricingMethodChange, market = 'USA' }: GEXByStrikeChartProps) {
  const [showAbsoluteGEX, setShowAbsoluteGEX] = useState(false)
  const [showVolumeChart, setShowVolumeChart] = useState(true)
  const [activeZoom, setActiveZoom] = useState<number | null>(null)

  const effectivePricingMethod = market === 'INDIA' ? 'black-scholes' : pricingMethod

  const filteredData = selectedExpiry === "All Dates"
    ? data
    : data.filter(option => option.expiration.toISOString().split("T")[0] === selectedExpiry)

  const specificExpiryDate = selectedExpiry === "All Dates" 
    ? undefined 
    : new Date(selectedExpiry + "T00:00:00.000Z")

  // Compute GEX and volume
  const gexByStrike = useMemo(() => computeGEXByStrike(spotPrice, filteredData, effectivePricingMethod), [spotPrice, filteredData, effectivePricingMethod])
  const volumeByStrike = useMemo(() => computeVolumeByStrike(filteredData), [filteredData])
  const zeroGammaLevel = useMemo(() => 
    findZeroGammaLevel(selectedExpiry === "All Dates" ? data : filteredData, spotPrice, specificExpiryDate), 
    [data, filteredData, spotPrice, selectedExpiry, specificExpiryDate]
  )

  // Merge strikes
  const allStrikes = Array.from(new Set([
    ...gexByStrike.map(item => item.strike),
    ...volumeByStrike.map(item => item.strike)
  ])).sort((a, b) => a - b)

  // ATM strike
  const atmStrike = useMemo(() => {
    if (allStrikes.length === 0) return spotPrice
    return allStrikes.reduce((prev, curr) => Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev, allStrikes[0])
  }, [allStrikes, spotPrice])

  // Zoom filtering
  const filteredStrikes = useMemo(() => {
    if (!activeZoom) return allStrikes
    const range = atmStrike * (activeZoom / 100)
    return allStrikes.filter(s => s >= atmStrike - range && s <= atmStrike + range)
  }, [allStrikes, atmStrike, activeZoom])

  // Map to filtered strikes
  const gammaValues = filteredStrikes.map(s => gexByStrike.find(i => i.strike === s)?.gex || 0)
  const volumeValues = filteredStrikes.map(s => volumeByStrike.find(i => i.strike === s)?.volume || 0)

  // Absolute GEX: separate calls and puts
  const callGEX = filteredStrikes.map(strike => {
    const callOptions = filteredData.filter(o => o.strike === strike && o.type === "C")
    let gex = 0
    callOptions.forEach(o => { if (o.GEX_BS) gex += Math.abs(o.GEX_BS) })
    return gex / 1e9
  })
  const putGEX = filteredStrikes.map(strike => {
    const putOptions = filteredData.filter(o => o.strike === strike && o.type === "P")
    let gex = 0
    putOptions.forEach(o => { if (o.GEX_BS) gex += Math.abs(o.GEX_BS) })
    return -gex / 1e9
  })

  // Axis ranges
  const maxNetGEX = Math.max(...gammaValues.map(Math.abs)) * 1.1 || 1
  const maxCallGEX = Math.max(...callGEX.map(Math.abs)) * 1.1 || 1
  const maxPutGEX = Math.max(...putGEX.map(Math.abs)) * 1.1 || 1
  const maxAbsGEX = Math.max(maxCallGEX, maxPutGEX)
  const maxGamma = showAbsoluteGEX ? maxAbsGEX : maxNetGEX
  const maxVolume = Math.max(...volumeValues) * 1.1 || 1

  // Helpers
  const findClosest = (target: number, arr: number[]) => {
    if (!arr.length) return null
    return arr.reduce((prev, curr) => Math.abs(target - curr) < Math.abs(target - prev) ? curr : prev, arr[0])
  }

  const formatExpiryLabel = (exp: string) => {
    if (exp === "All Dates") return "≤2M"
    const days = Math.ceil((new Date(exp + "T00:00:00.000Z").getTime() - Date.now()) / 86400000)
    if (days <= 7) return `≤${days}DTE`
    return `≤${exp}`
  }

  // ─── Chart configs using design tokens ───────────────────────

  const gammaOptions: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 8, right: 16, bottom: 8, left: 16 } },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: colors.text.secondary,
          font: { family: typography.fontSans, size: 11 },
          usePointStyle: true,
          pointStyle: 'rect',
          padding: 12,
        },
      },
      title: {
        display: true,
        text: `${ticker} ${showAbsoluteGEX ? 'Absolute' : 'Net'} Gamma by Strike (${selectedExpiry === "All Dates" ? "All Expiries" : selectedExpiry})`,
        color: colors.text.primary,
        font: { family: typography.fontSans, size: 13, weight: 'bold' as const },
        padding: { top: 8, bottom: 12 },
      },
      tooltip: {
        backgroundColor: chartTheme.tooltip.bg,
        titleColor: chartTheme.tooltip.text,
        bodyColor: chartTheme.tooltip.text,
        borderColor: chartTheme.tooltip.border,
        borderWidth: 1,
        padding: 10,
        titleFont: { family: typography.fontSans, size: 12 },
        bodyFont: { family: typography.fontMono, size: 11 },
        callbacks: {
          label: (ctx) => {
            const value = ctx.raw as number
            if (showAbsoluteGEX) {
              if (ctx.datasetIndex === 0) return `Calls GEX: ${value.toFixed(3)}B`
              if (ctx.datasetIndex === 1) return `Puts GEX: ${Math.abs(value).toFixed(3)}B`
              return ctx.dataset.label || ''
            } else {
              if (ctx.datasetIndex === 0) {
                const sign = value >= 0 ? '+' : ''
                return `Net GEX: ${sign}${value.toFixed(3)}B`
              }
              return ctx.dataset.label || ''
            }
          },
        },
      },
    },
    scales: {
      y: {
        grid: { color: chartTheme.gridSubtle },
        ticks: {
          color: colors.text.muted,
          font: { family: typography.fontMono, size: 10 },
          maxTicksLimit: 14,
          padding: 6,
          autoSkip: true,
        },
        reverse: true,
        border: { color: chartTheme.grid },
      },
      x: {
        grid: { color: chartTheme.gridSubtle },
        ticks: {
          color: colors.text.muted,
          font: { family: typography.fontMono, size: 10 },
          maxTicksLimit: 8,
        },
        title: {
          display: true,
          text: showAbsoluteGEX ? "Gamma (Calls → | ← Puts)" : "Net Gamma",
          color: colors.text.secondary,
          font: { family: typography.fontSans, size: 11 },
        },
        min: -maxGamma,
        max: maxGamma,
        border: { color: chartTheme.grid },
      },
    },
  }

  const volumeOptions: ChartOptions<'bar'> = {
    ...gammaOptions,
    plugins: {
      ...gammaOptions.plugins,
      title: {
        display: true,
        text: `${ticker} Volume by Strike`,
        color: colors.text.primary,
        font: { family: typography.fontSans, size: 13, weight: 'bold' as const },
        padding: { top: 8, bottom: 12 },
      },
    },
    scales: {
      ...gammaOptions.scales,
      x: {
        grid: { color: chartTheme.gridSubtle },
        ticks: { color: colors.text.muted, font: { family: typography.fontMono, size: 10 } },
        title: {
          display: true,
          text: "Volume (Contracts)",
          color: colors.text.secondary,
          font: { family: typography.fontSans, size: 11 },
        },
        min: 0,
        max: maxVolume,
        border: { color: chartTheme.grid },
      },
    },
  }

  // ─── Chart data ──────────────────────────────────────────────

  const gammaData = {
    labels: filteredStrikes,
    datasets: showAbsoluteGEX ? [
      {
        label: "Calls (Absolute)",
        data: callGEX,
        backgroundColor: colors.accentAlpha.green50,
        borderColor: colors.accent.green,
        borderWidth: 1,
        barThickness: 8,
        order: 1,
      },
      {
        label: "Puts (Absolute)",
        data: putGEX,
        backgroundColor: colors.accentAlpha.red50,
        borderColor: colors.accent.red,
        borderWidth: 1,
        barThickness: 8,
        order: 1,
      },
      // Spot reference
      {
        label: `Spot: ${spotPrice.toFixed(2)}`,
        data: filteredStrikes.map(s => s === findClosest(spotPrice, filteredStrikes) ? maxGamma * 0.95 : 0),
        backgroundColor: colors.accentAlpha.amber50,
        borderColor: colors.accent.amber,
        borderWidth: 1,
        barThickness: 2,
        order: 3,
      },
      // Gamma flip reference
      ...(zeroGammaLevel ? [{
        label: `Γ-Flip (${formatExpiryLabel(selectedExpiry)}): ${zeroGammaLevel.toFixed(2)}`,
        data: filteredStrikes.map(s => s === findClosest(zeroGammaLevel, filteredStrikes) ? maxGamma * 0.95 : 0),
        backgroundColor: colors.accentAlpha.magenta50,
        borderColor: colors.accent.magenta,
        borderWidth: 1,
        barThickness: 2,
        order: 3,
      }] : []),
    ] : [
      {
        label: "Net Gamma",
        data: gammaValues,
        backgroundColor: gammaValues.map(v => v >= 0 ? colors.accentAlpha.green50 : colors.accentAlpha.red50),
        borderColor: gammaValues.map(v => v >= 0 ? colors.accent.green : colors.accent.red),
        borderWidth: 1,
        barThickness: 8,
        order: 1,
      },
      {
        label: `Spot: ${spotPrice.toFixed(2)}`,
        data: filteredStrikes.map(s => s === findClosest(spotPrice, filteredStrikes) ? maxGamma * 0.95 : 0),
        backgroundColor: colors.accentAlpha.amber50,
        borderColor: colors.accent.amber,
        borderWidth: 1,
        barThickness: 2,
        order: 3,
      },
      ...(zeroGammaLevel ? [{
        label: `Γ-Flip (${formatExpiryLabel(selectedExpiry)}): ${zeroGammaLevel.toFixed(2)}`,
        data: filteredStrikes.map(s => s === findClosest(zeroGammaLevel, filteredStrikes) ? maxGamma * 0.95 : 0),
        backgroundColor: colors.accentAlpha.magenta50,
        borderColor: colors.accent.magenta,
        borderWidth: 1,
        barThickness: 2,
        order: 3,
      }] : []),
    ],
  }

  const volumeData = {
    labels: filteredStrikes,
    datasets: [{
      label: "Trading Volume",
      data: volumeValues,
      backgroundColor: colors.accentAlpha.cyan40,
      borderColor: colors.accent.cyan,
      borderWidth: 1,
      barThickness: 8,
    }],
  }

  // ─── Zoom controls ──────────────────────────────────────────

  const zoomPercents = [1, 2, 3, 5, 10, 20, 30]

  return (
    <div className="flex flex-col gap-3 w-full h-full overflow-hidden bg-[#0A0A0A] rounded p-3">
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
                  : 'bg-transparent text-[#525252] border-[#1A1A1A] hover:border-[#333]'
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
                : 'bg-transparent text-[#525252] border-[#1A1A1A] hover:border-[#333]'
            }`}
            onClick={() => setActiveZoom(null)}
            type="button"
          >
            RESET
          </button>
        </div>
        
        {/* Right controls */}
        <div className="flex items-center gap-2">
          {market === 'USA' ? (
            <PricingMethodToggle 
              pricingMethod={pricingMethod}
              onPricingMethodChange={onPricingMethodChange}
            />
          ) : (
            <span className="text-xxs text-[#525252] font-mono px-2 py-1 border border-[#1A1A1A] rounded">
              BLACK-SCHOLES (EUR)
            </span>
          )}
          
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
          
          <button
            className={`px-1.5 py-0.5 rounded text-xxs font-mono border transition-colors ${
              showVolumeChart
                ? 'text-terminal-cyan border-terminal-cyan/30'
                : 'text-[#525252] border-[#1A1A1A]'
            }`}
            onClick={() => setShowVolumeChart(!showVolumeChart)}
            type="button"
            title={showVolumeChart ? "Hide Volume" : "Show Volume"}
          >
            VOL
          </button>
        </div>
      </div>
      
      {/* Charts */}
      <div className={`grid gap-3 w-full flex-1 ${showVolumeChart ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        <div className="relative min-h-[300px]">
          <div className="absolute inset-0">
            <Bar options={gammaOptions} data={gammaData} />
          </div>
        </div>
        {showVolumeChart && (
          <div className="relative min-h-[300px]">
            <div className="absolute inset-0">
              <Bar options={volumeOptions} data={volumeData} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
