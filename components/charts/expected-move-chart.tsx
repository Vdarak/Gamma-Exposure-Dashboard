"use client"

import { useMemo } from "react"
import { Line } from "react-chartjs-2"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
  TimeScale,
} from "chart.js"
import "chartjs-adapter-date-fns"

import type { OptionData } from "@/lib/types"
import { calculateExpectedMove } from "@/lib/calculations"
import { colors, chartTheme, typography } from "@/lib/design-tokens"

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, TimeScale)

interface ExpectedMoveChartProps {
  data: OptionData[]
  ticker: string
  spotPrice: number
  selectedExpiry: string
}

export function ExpectedMoveChart({ data, ticker, spotPrice, selectedExpiry }: ExpectedMoveChartProps) {
  const chartData = useMemo(() => {
    const selectedDate = selectedExpiry !== "All Dates" ? new Date(selectedExpiry + "T00:00:00Z") : undefined
    const expectedMoves = calculateExpectedMove(data, spotPrice, selectedDate)

    return {
      datasets: expectedMoves.map((move) => ({
        date: move.date,
        upperBound: move.upper,
        lowerBound: move.lower,
        upperPct: move.upperPct,
        lowerPct: move.lowerPct,
      })),
    }
  }, [data, spotPrice, selectedExpiry])

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        labels: {
          color: colors.text.secondary,
          font: { family: typography.fontSans, size: 11 },
          usePointStyle: true,
          padding: 16,
        },
      },
      title: {
        display: true,
        text: `${ticker} Expected Move${selectedExpiry !== "All Dates" ? ` (Expiry: ${selectedExpiry})` : " (All Expiries)"}`,
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
          title: (items) => {
            if (items.length > 0) {
              const date = new Date(items[0].parsed.x)
              return date.toLocaleDateString("en-CA")
            }
            return ""
          },
          label: (ctx) => {
            const dataIndex = ctx.dataIndex
            const moveData = chartData.datasets[dataIndex]

            if (ctx.datasetIndex === 1) {
              return `Upper: ${moveData.upperBound.toFixed(2)} (${moveData.upperPct > 0 ? "+" : ""}${moveData.upperPct}%)`
            } else if (ctx.datasetIndex === 2) {
              return `Lower: ${moveData.lowerBound.toFixed(2)} (${moveData.lowerPct > 0 ? "+" : ""}${moveData.lowerPct}%)`
            }
            return `Spot: ${ctx.parsed.y.toFixed(2)}`
          },
        },
      },
    },
    scales: {
      x: {
        type: "time",
        time: {
          unit: "month",
          tooltipFormat: "yyyy-MM-dd",
          displayFormats: {
            day: "MMM dd",
            week: "MMM dd",
            month: "MMM yyyy",
          },
        },
        grid: { color: chartTheme.gridSubtle },
        ticks: {
          color: colors.text.muted,
          font: { family: typography.fontMono, size: 10 },
          source: "auto",
          maxRotation: 45,
          minRotation: 45,
        },
        title: {
          display: true,
          text: "Expiration Date",
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
          text: "Strike Price",
          color: colors.text.secondary,
          font: { family: typography.fontSans, size: 11, weight: "normal" as const },
        },
        border: { color: chartTheme.grid },
      },
    },
  }

  const chartDataConfig = {
    datasets: [
      {
        label: "Current Price",
        data: chartData.datasets.map((move) => ({ x: move.date, y: spotPrice })),
        borderColor: colors.accent.amber,
        backgroundColor: colors.accentMuted.amber,
        borderDash: [5, 5],
        pointRadius: 0,
        borderWidth: 1.5,
      },
      {
        label: "Upper Bound (16Δ Call)",
        data: chartData.datasets.map((move) => ({ x: move.date, y: move.upperBound })),
        borderColor: colors.accent.green,
        backgroundColor: colors.accentMuted.green,
        borderDash: [3, 3],
        pointRadius: 5,
        pointBackgroundColor: colors.accent.green,
        borderWidth: 1.5,
      },
      {
        label: "Lower Bound (16Δ Put)",
        data: chartData.datasets.map((move) => ({ x: move.date, y: move.lowerBound })),
        borderColor: colors.accent.red,
        backgroundColor: colors.accentMuted.red,
        borderDash: [3, 3],
        pointRadius: 5,
        pointBackgroundColor: colors.accent.red,
        borderWidth: 1.5,
      },
    ],
  }

  return <Line options={options} data={chartDataConfig} />
}
