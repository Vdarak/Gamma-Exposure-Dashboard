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
import { calcGammaEx } from "@/lib/calculations"

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

interface GammaRampChartProps {
  data: OptionData[]
  ticker: string
  spotPrice: number
  selectedExpiry: string // Add this line
}

export function GammaRampChart({ data, ticker, spotPrice, selectedExpiry }: GammaRampChartProps) {
  // Add selectedExpiry here
  const chartData = useMemo(() => {
    const today = new Date()
    let filteredData = data

    if (selectedExpiry !== "All Dates") {
      const selectedDate = new Date(selectedExpiry)
      filteredData = data.filter((option) => option.expiration.toDateString() === selectedDate.toDateString())
    }

    // Calculate days till expiration for Black-Scholes
    filteredData.forEach((option) => {
      // Use filteredData here
      const daysDiff = Math.max(1, Math.ceil((option.expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
      option.daysTillExp = daysDiff === 0 ? 1 / 262 : daysDiff / 262
    })

    // Group by strike for calls and puts separately
    const calls = filteredData.filter((option) => option.type === "C") // Use filteredData
    const puts = filteredData.filter((option) => option.type === "P") // Use filteredData
    // ... rest of the logic remains the same, operating on calls and puts derived from filteredData

    const callsByStrike = new Map<number, { iv: number; daysTillExp: number; oi: number }>()
    const putsByStrike = new Map<number, { iv: number; daysTillExp: number; oi: number }>()

    calls.forEach((option) => {
      const existing = callsByStrike.get(option.strike)
      if (existing) {
        existing.oi += option.open_interest
        // Optionally average IV or use first, depending on desired logic
        // existing.iv = (existing.iv * (existing.oi - option.open_interest) + option.iv * option.open_interest) / existing.oi;
      } else {
        callsByStrike.set(option.strike, {
          iv: option.iv,
          daysTillExp: option.daysTillExp!,
          oi: option.open_interest,
        })
      }
    })

    puts.forEach((option) => {
      const existing = putsByStrike.get(option.strike)
      if (existing) {
        existing.oi += option.open_interest
      } else {
        putsByStrike.set(option.strike, {
          iv: option.iv,
          daysTillExp: option.daysTillExp!,
          oi: option.open_interest,
        })
      }
    })

    // Calculate gamma exposure for each strike
    const callGammaByStrike = new Map<number, number>()
    const putGammaByStrike = new Map<number, number>()

    callsByStrike.forEach((optionData, strike) => {
      const gamma = calcGammaEx(spotPrice, strike, optionData.iv, optionData.daysTillExp, 0, 0, "call", optionData.oi)
      callGammaByStrike.set(strike, gamma)
    })

    putsByStrike.forEach((optionData, strike) => {
      const gamma = -calcGammaEx(spotPrice, strike, optionData.iv, optionData.daysTillExp, 0, 0, "put", optionData.oi)
      putGammaByStrike.set(strike, gamma)
    })

    // Get all strikes and sort them
    const allStrikes = new Set([...callGammaByStrike.keys(), ...putGammaByStrike.keys()])
    const strikes = Array.from(allStrikes).sort((a, b) => a - b)

    const callDataResult = strikes.map((strike) => callGammaByStrike.get(strike) || 0)
    const putDataResult = strikes.map((strike) => putGammaByStrike.get(strike) || 0)

    return { strikes, callData: callDataResult, putData: putDataResult }
  }, [data, spotPrice, selectedExpiry]) // Add selectedExpiry to dependency array

  // Calculate dynamic min/max for strikes
  const minStrike = chartData.strikes.length > 0 ? Math.min(...chartData.strikes) : undefined
  const maxStrike = chartData.strikes.length > 0 ? Math.max(...chartData.strikes) : undefined
  let xMin: number | undefined = undefined
  let xMax: number | undefined = undefined
  if (minStrike !== undefined && maxStrike !== undefined) {
    const range = maxStrike - minStrike
    const pad = Math.max(1, Math.round(range * 0.02)) // 2% padding or at least 1
    xMin = minStrike - pad
    xMax = maxStrike + pad
  }

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
        text: `${ticker} Gamma Ramp ${new Date().toISOString().split("T")[0]}${selectedExpiry !== "All Dates" ? ` (Expiry: ${selectedExpiry})` : " (All Expiries)"}`, // Modify this line
        color: "#FFF",
        font: {
          size: 16,
          weight: "bold",
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => `${context.dataset.label}: ${context.parsed.y.toLocaleString()} shares`,
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
        min: xMin,
        max: xMax,
      },
      y: {
        grid: {
          color: "#2A3459",
        },
        ticks: {
          color: "#FFF",
          callback: (value) => Number(value).toLocaleString(),
        },
        title: {
          display: true,
          text: "Shares",
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
        label: "Calls",
        data: chartData.callData,
        backgroundColor: "rgba(0, 255, 0, 0.7)",
        borderColor: "rgba(0, 255, 0, 1)",
        borderWidth: 1,
      },
      {
        label: "Puts",
        data: chartData.putData,
        backgroundColor: "rgba(255, 0, 0, 0.7)",
        borderColor: "rgba(255, 0, 0, 1)",
        borderWidth: 1,
      },
    ],
  }

  return (
    <div className="relative h-full">
      <Bar options={options} data={chartDataConfig} />
      {/* Spot price indicator */}
      <div className="absolute top-4 right-4 text-xs space-y-1">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-0.5 bg-yellow-400 border-dashed border-t"></div>
          <span className="text-yellow-400">Spot: {spotPrice.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}
