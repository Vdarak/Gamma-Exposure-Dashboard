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
  TimeScale,
} from "chart.js"
import "chartjs-adapter-date-fns"

import type { OptionData } from "@/lib/types"
import { computeGEXByExpiration } from "@/lib/calculations"
import { colors, chartTheme, typography } from "@/lib/design-tokens"

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, TimeScale)

interface GEXByExpirationChartProps {
  data: OptionData[]
  ticker: string
}

export function GEXByExpirationChart({ data, ticker }: GEXByExpirationChartProps) {
  const chartData = useMemo(() => {
    const gexByExpiration = computeGEXByExpiration(data)
    return {
      datasets: gexByExpiration.map((item) => ({ x: new Date(item.expiration + "T00:00:00Z"), y: item.gex })),
    }
  }, [data])

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: `${ticker} GEX by Expiration`,
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
              if (isNaN(date.getTime())) return ""
              return date.toLocaleDateString("en-CA", { timeZone: "UTC" })
            }
            return ""
          },
          label: (ctx) => `GEX: ${ctx.parsed.y.toFixed(4)} Bn$`,
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
          maxRotation: 45,
          minRotation: 45,
          source: "auto",
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
          text: "Gamma Exposure (Bn$ / %)",
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
        data: chartData.datasets,
        backgroundColor: colors.accentAlpha.magenta50,
        borderColor: colors.accent.magenta,
        borderWidth: 1,
        barPercentage: 0.7,
        categoryPercentage: 0.8,
      },
    ],
  }

  return <Bar options={options} data={chartDataConfig} />
}
