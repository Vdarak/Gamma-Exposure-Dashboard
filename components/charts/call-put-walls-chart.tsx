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

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

interface CallPutWallsChartProps {
  data: OptionData[]
  ticker: string
  selectedExpiry: Date
}

export function CallPutWallsChart({ data, ticker, selectedExpiry }: CallPutWallsChartProps) {
  const chartData = useMemo(() => {
    const walls = computeCallPutWalls(data, selectedExpiry)

    // Combine all strikes
    const allStrikes = new Set([...walls.callOI.map((item) => item.strike), ...walls.putOI.map((item) => item.strike)])

    const strikes = Array.from(allStrikes).sort((a, b) => a - b)

    const callData = strikes.map((strike) => {
      const callItem = walls.callOI.find((item) => item.strike === strike)
      return callItem ? callItem.oi : 0
    })

    const putData = strikes.map((strike) => {
      const putItem = walls.putOI.find((item) => item.strike === strike)
      return putItem ? putItem.oi : 0
    })

    return { strikes, callData, putData, walls }
  }, [data, selectedExpiry])

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        labels: {
          color: "#FFF",
        },
      },
      title: {
        display: true,
        text: `${ticker} Call/Put Walls (Expiry: ${selectedExpiry.toISOString().split("T")[0]})`,
        color: "#FFF",
        font: {
          size: 16,
          weight: "bold",
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => `${context.dataset.label}: ${context.parsed.y.toLocaleString()} contracts`,
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: "#2A3459",
        },
        ticks: {
          color: "#FFF",
        },
        title: {
          display: true,
          text: "Strike",
          color: "#FFF",
          font: {
            weight: "bold",
          },
        },
      },
      y: {
        grid: {
          color: "#2A3459",
        },
        ticks: {
          color: "#FFF",
        },
        title: {
          display: true,
          text: "Open Interest",
          color: "#FFF",
          font: {
            weight: "bold",
          },
        },
      },
    },
  }

  const chartDataConfig = {
    labels: chartData.strikes,
    datasets: [
      {
        label: "Calls OI",
        data: chartData.callData,
        backgroundColor: "rgba(83, 187, 254, 0.5)",
        borderColor: "rgba(83, 187, 254, 1)",
        borderWidth: 1,
      },
      {
        label: "Puts OI",
        data: chartData.putData,
        backgroundColor: "rgba(254, 83, 187, 0.5)",
        borderColor: "rgba(254, 83, 187, 1)",
        borderWidth: 1,
      },
    ],
  }

  return (
    <div className="relative h-full">
      <Bar options={options} data={chartDataConfig} />
      {/* Wall indicators */}
      <div className="absolute top-4 right-4 text-xs space-y-1">
        {chartData.walls.callWall && (
          <div className="flex items-center space-x-2">
            <div className="w-3 h-0.5 bg-blue-400 border-dashed border-t"></div>
            <span className="text-blue-400">Call Wall: {chartData.walls.callWall}</span>
          </div>
        )}
        {chartData.walls.putWall && (
          <div className="flex items-center space-x-2">
            <div className="w-3 h-0.5 bg-pink-400 border-dashed border-t"></div>
            <span className="text-pink-400">Put Wall: {chartData.walls.putWall}</span>
          </div>
        )}
      </div>
    </div>
  )
}
