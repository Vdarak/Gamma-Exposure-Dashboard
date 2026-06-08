"use client"

import React, { useMemo } from "react"
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
} from "chart.js"
import type { OptionData } from "@/lib/types"
import { colors, chartTheme, typography } from "@/lib/design-tokens"

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

interface GEXDataGraphDashboardProps {
  data: OptionData[]
}

export const GEXDataGraphDashboard: React.FC<GEXDataGraphDashboardProps> = ({ data }) => {
  const chartData = useMemo(() => {
    const grouped: Record<string, { totalGamma: number; netGamma: number }> = {}
    data.forEach((o) => {
      const dateKey = new Date(o.expiration).toISOString().split("T")[0]
      if (!grouped[dateKey]) grouped[dateKey] = { totalGamma: 0, netGamma: 0 }
      const oi = o.open_interest || 0
      const gammaValue = typeof o.gamma === "number" ? o.gamma * oi * 100 : 0
      grouped[dateKey].totalGamma += gammaValue
      grouped[dateKey].netGamma += o.type === "C" ? gammaValue : -gammaValue
    })
    return Object.entries(grouped)
      .map(([date, { totalGamma, netGamma }]) => ({ date, totalGamma, netGamma }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [data])

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
        text: "Total & Net Gamma by Expiration",
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
          label: (ctx) => `${ctx.dataset.label}: ${new Intl.NumberFormat("en").format(ctx.parsed.y)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: chartTheme.gridSubtle },
        ticks: {
          color: colors.text.muted,
          font: { family: typography.fontMono, size: 10 },
          maxRotation: 45,
          minRotation: 45,
        },
        border: { color: chartTheme.grid },
      },
      y: {
        grid: { color: chartTheme.gridSubtle },
        ticks: {
          color: colors.text.muted,
          font: { family: typography.fontMono, size: 10 },
        },
        border: { color: chartTheme.grid },
      },
    },
  }

  const chartDataConfig = {
    labels: chartData.map((d) => d.date),
    datasets: [
      {
        label: "Total Gamma",
        data: chartData.map((d) => d.totalGamma),
        borderColor: colors.accent.purple,
        backgroundColor: colors.accentMuted.purple,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0,
      },
      {
        label: "Net Gamma",
        data: chartData.map((d) => d.netGamma),
        borderColor: colors.accent.green,
        backgroundColor: colors.accentMuted.green,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0,
      },
    ],
  }

  return (
    <div className="h-full w-full">
      <Line options={options} data={chartDataConfig} />
    </div>
  )
}
