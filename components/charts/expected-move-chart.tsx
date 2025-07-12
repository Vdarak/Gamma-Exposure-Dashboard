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
  TimeScale, // Import TimeScale
} from "chart.js"
import "chartjs-adapter-date-fns" // Import adapter

import type { OptionData } from "@/lib/types"
import { calculateExpectedMove } from "@/lib/calculations"

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, TimeScale) // Register TimeScale

interface ExpectedMoveChartProps {
  data: OptionData[]
  ticker: string
  spotPrice: number
  selectedExpiry: string
}

export function ExpectedMoveChart({ data, ticker, spotPrice, selectedExpiry }: ExpectedMoveChartProps) {
  const chartData = useMemo(() => {
    const selectedDate = selectedExpiry !== "All Dates" ? new Date(selectedExpiry + "T00:00:00Z") : undefined // Ensure UTC
    const expectedMoves = calculateExpectedMove(data, spotPrice, selectedDate) // expectedMoves returns { date: Date, ... }

    return {
      // dates are already Date objects
      datasets: expectedMoves.map((move) => ({
        date: move.date, // Already a Date object
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
          color: "#FFF",
        },
      },
      title: {
        display: true,
        text: `${ticker} Expected Move${selectedExpiry !== "All Dates" ? ` (Expiry: ${selectedExpiry})` : " (All Expiries)"}`,
        color: "#FFF",
        font: {
          size: 16,
          weight: "bold",
        },
      },
      tooltip: {
        callbacks: {
          title: (tooltipItems) => {
            if (tooltipItems.length > 0) {
              const date = new Date(tooltipItems[0].parsed.x)
              return date.toLocaleDateString("en-CA") // YYYY-MM-DD
            }
            return ""
          },
          label: (context) => {
            const datasetIndex = context.datasetIndex
            const dataIndex = context.dataIndex
            const moveData = chartData.datasets[dataIndex]

            if (datasetIndex === 1) {
              // Upper Bound
              return `Upper: ${moveData.upperBound.toFixed(2)} (${moveData.upperPct > 0 ? "+" : ""}${moveData.upperPct}%)`
            } else if (datasetIndex === 2) {
              // Lower Bound
              return `Lower: ${moveData.lowerBound.toFixed(2)} (${moveData.lowerPct > 0 ? "+" : ""}${moveData.lowerPct}%)`
            }
            return `Spot: ${context.parsed.y.toFixed(2)}`
          },
        },
      },
    },
    scales: {
      x: {
        type: "time", // Use time scale
        time: {
          unit: "month",
          tooltipFormat: "yyyy-MM-dd",
          displayFormats: {
            millisecond: "HH:mm:ss.SSS",
            second: "HH:mm:ss",
            minute: "HH:mm",
            hour: "HH:mm",
            day: "MMM dd",
            week: "MMM dd",
            month: "MMM yyyy",
            quarter: "QQQ yyyy",
            year: "yyyy",
          },
        },
        grid: {
          color: "#2A3459",
        },
        ticks: {
          color: "#FFF",
          source: "auto",
          maxRotation: 45,
          minRotation: 45,
        },
        title: {
          display: true,
          text: "Expiration Date",
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
          text: "Strike Price",
          color: "#FFF",
          font: {
            weight: "bold",
          },
        },
      },
    },
  }

  const chartDataConfig = {
    // labels are implicitly handled by the x values in datasets
    datasets: [
      {
        label: "Current Price",
        data: chartData.datasets.map((move) => ({ x: move.date, y: spotPrice })),
        borderColor: "rgba(255, 255, 255, 1)",
        backgroundColor: "rgba(255, 255, 255, 0.1)",
        borderDash: [5, 5],
        pointRadius: 0,
      },
      {
        label: "Upper Bound (16Δ Call)",
        data: chartData.datasets.map((move) => ({ x: move.date, y: move.upperBound })),
        borderColor: "rgba(34, 197, 94, 1)",
        backgroundColor: "rgba(34, 197, 94, 0.1)",
        borderDash: [3, 3],
        pointRadius: 6,
        pointBackgroundColor: "rgba(34, 197, 94, 1)",
      },
      {
        label: "Lower Bound (16Δ Put)",
        data: chartData.datasets.map((move) => ({ x: move.date, y: move.lowerBound })),
        borderColor: "rgba(239, 68, 68, 1)",
        backgroundColor: "rgba(239, 68, 68, 0.1)",
        borderDash: [3, 3],
        pointRadius: 6,
        pointBackgroundColor: "rgba(239, 68, 68, 1)",
      },
    ],
  }

  return <Line options={options} data={chartDataConfig} />
}
