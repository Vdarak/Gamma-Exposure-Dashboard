"use client"

import { useMemo } from "react"
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
import { computeCallPutWalls } from "@/lib/calculations"
import { colors, chartTheme, typography } from "@/lib/design-tokens"

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

interface CallPutWallsChartProps {
  data: OptionData[]
  ticker: string
  selectedExpiry: Date
}

export function CallPutWallsChart({ data, ticker, selectedExpiry }: CallPutWallsChartProps) {
  const chartData = useMemo(() => {
    const walls = computeCallPutWalls(data, selectedExpiry)
    const allStrikes = new Set([...walls.callOI.map((i) => i.strike), ...walls.putOI.map((i) => i.strike)])
    const strikes = Array.from(allStrikes).sort((a, b) => a - b)

    const callData = strikes.map((s) => walls.callOI.find((i) => i.strike === s)?.oi || 0)
    const putData = strikes.map((s) => walls.putOI.find((i) => i.strike === s)?.oi || 0)

    return { strikes, callData, putData, walls }
  }, [data, selectedExpiry])

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        labels: {
          color: colors.text.secondary,
          font: { family: typography.fontSans, size: 11 },
          usePointStyle: true,
          pointStyle: 'rect',
          padding: 16,
        },
      },
      title: {
        display: true,
        text: `${ticker} Call/Put Walls (Expiry: ${selectedExpiry.toISOString().split("T")[0]})`,
        color: colors.text.primary,
        font: { family: typography.fontSans, size: 13, weight: "bold" as const },
        padding: { top: 8, bottom: 16 },
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
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()} contracts`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: chartTheme.gridSubtle },
        ticks: {
          color: colors.text.muted,
          font: { family: typography.fontMono, size: 10 },
        },
        title: {
          display: true,
          text: "Strike",
          color: colors.text.secondary,
          font: { family: typography.fontSans, size: 11, weight: "normal" as const },
        },
        border: { color: chartTheme.grid },
      },
      y: {
        grid: { color: chartTheme.gridSubtle },
        ticks: {
          color: colors.text.muted,
          font: { family: typography.fontMono, size: 10 },
        },
        title: {
          display: true,
          text: "Open Interest",
          color: colors.text.secondary,
          font: { family: typography.fontSans, size: 11, weight: "normal" as const },
        },
        border: { color: chartTheme.grid },
      },
    },
  }

  const chartDataConfig = {
    labels: chartData.strikes,
    datasets: [
      {
        label: "Calls OI",
        data: chartData.callData,
        backgroundColor: colors.accentAlpha.green50,
        borderColor: colors.accent.green,
        borderWidth: 1,
      },
      {
        label: "Puts OI",
        data: chartData.putData,
        backgroundColor: colors.accentAlpha.red50,
        borderColor: colors.accent.red,
        borderWidth: 1,
      },
    ],
  }

  return (
    <div className="relative h-full">
      <Bar options={options} data={chartDataConfig} />
      {/* Wall indicators */}
      <div className="absolute top-12 right-4 flex flex-col gap-1">
        {chartData.walls.callWall && (
          <div className="flex items-center gap-2 px-2 py-1 bg-[#0A0A0A] border border-[#1A1A1A] rounded">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors.accent.green }} />
            <span className="text-xxs font-mono text-[#737373]">
              Call Wall: <span className="text-terminal-green">{chartData.walls.callWall}</span>
            </span>
          </div>
        )}
        {chartData.walls.putWall && (
          <div className="flex items-center gap-2 px-2 py-1 bg-[#0A0A0A] border border-[#1A1A1A] rounded">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors.accent.red }} />
            <span className="text-xxs font-mono text-[#737373]">
              Put Wall: <span className="text-terminal-red">{chartData.walls.putWall}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
