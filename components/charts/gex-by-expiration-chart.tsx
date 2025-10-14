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
  TimeScale, // Import TimeScale
} from "chart.js"
import "chartjs-adapter-date-fns" // Import adapter

import type { OptionData } from "@/lib/types"
import { computeGEXByExpiration } from "@/lib/calculations"

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, TimeScale) // Register TimeScale

interface GEXByExpirationChartProps {
  data: OptionData[]
  ticker: string
}

export function GEXByExpirationChart({ data, ticker }: GEXByExpirationChartProps) {
  const chartData = useMemo(() => {
    const gexByExpiration = computeGEXByExpiration(data) // This returns { expiration: "YYYY-MM-DD", gex: number }[]
    return {
      // Convert "YYYY-MM-DD" strings to Date objects for TimeScale
      datasets: gexByExpiration.map((item) => ({ x: new Date(item.expiration + "T00:00:00Z"), y: item.gex })), // Ensure UTC interpretation
    }
  }, [data])

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: `${ticker} GEX by Expiration`,
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
              if (isNaN(date.getTime())) return ""
              return date.toLocaleDateString("en-CA", { timeZone: "UTC" }) // YYYY-MM-DD
            }
            return ""
          },
          label: (context) => `GEX: ${context.parsed.y.toFixed(4)} Bn$`,
        },
      },
    },
    scales: {
      x: {
        type: "time", // Use time scale
        time: {
          unit: "month", // Adjust unit as needed (day, week, month)
          tooltipFormat: "yyyy-MM-dd", // Format for tooltips
          displayFormats: {
            millisecond: "HH:mm:ss.SSS",
            second: "HH:mm:ss",
            minute: "HH:mm",
            hour: "HH:mm",
            day: "MMM dd", // e.g., Jun 20
            week: "MMM dd",
            month: "MMM yyyy", // e.g., Jun 2025
            quarter: "QQQ yyyy",
            year: "yyyy",
          },
        },
        grid: {
          color: "#2A3459",
        },
        ticks: {
          color: "#FFF",
          maxRotation: 45,
          minRotation: 45,
          source: "auto",
          callback: function (value: string | number, index: number, ticks: any[]) {
            // `this` refers to the scale object
            // For Chart.js v3/v4, the first argument `value` is the tick value (timestamp)
            const date = new Date(value as number) // value is a timestamp
            if (isNaN(date.getTime())) return String(value) // Fallback if not a valid date

            const timeUnit = (this.chart.options.scales?.x as any)?.time?.unit

            if (timeUnit === "month" || timeUnit === "quarter" || timeUnit === "year") {
              return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
            }
            return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
          },
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
          text: "Gamma Exposure (Bn$ / %)",
          color: "#FFF",
          font: {
            weight: "bold",
          },
        },
      },
    },
  }

  const chartDataConfig = {
    datasets: [
      {
        // data is now an array of objects {x: Date, y: number}
        data: chartData.datasets,
        backgroundColor: "rgba(254, 83, 187, 0.5)",
        borderColor: "rgba(254, 83, 187, 1)",
        borderWidth: 1,
        barPercentage: 0.7,
        categoryPercentage: 0.8,
      },
    ],
  }

  return <Bar options={options} data={chartDataConfig} />
}
