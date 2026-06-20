"use client"

import { useMemo, useState } from "react"
import type { OptionData } from "@/lib/types"
import dynamic from "next/dynamic"
import { colors, chartTheme, typography } from "@/lib/design-tokens"

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false })

interface IVSurfaceChartProps {
  data: OptionData[]
  ticker: string
  spotPrice: number
  selectedExpiries: string[]
  onModeChange?: (mode: '90d' | '0dte' | 'custom') => void
  onSelectedExpiriesChange?: (expiries: string[]) => void
  availableExpiries?: string[]
}

export function IVSurfaceChart({
  data,
  ticker,
  spotPrice,
  selectedExpiries,
  onModeChange,
  onSelectedExpiriesChange,
  availableExpiries,
}: IVSurfaceChartProps) {
  const [plotLoaded, setPlotLoaded] = useState(false)

  const { x, y, z, zRange } = useMemo(() => {
    // Filter by user-selected expiries and standard strike range (±15%)
    let filtered: OptionData[]
    if (selectedExpiries.length === 0) {
      const oneYear = new Date()
      oneYear.setFullYear(oneYear.getFullYear() + 1)
      filtered = data.filter(
        (option) => option.expiration < oneYear && option.strike > spotPrice * 0.85 && option.strike < spotPrice * 1.15,
      )
    } else {
      filtered = data.filter(
        (option) =>
          selectedExpiries.includes(option.expiration.toISOString().split("T")[0]) &&
          option.strike > spotPrice * 0.85 &&
          option.strike < spotPrice * 1.15,
      )
    }

    const expirations = Array.from(new Set(filtered.map((o) => o.expiration.toISOString().split("T")[0]))).sort()
    const strikes = Array.from(new Set(filtered.map((o) => o.strike))).sort((a, b) => a - b)

    // Build a lookup mapping expiration_strike to the list of option contracts at that node
    const optionsLookup = new Map<string, OptionData[]>()
    filtered.forEach((o) => {
      const expKey = o.expiration.toISOString().split("T")[0]
      const key = `${expKey}_${o.strike}`
      const existing = optionsLookup.get(key) || []
      existing.push(o)
      optionsLookup.set(key, existing)
    })

    const z: number[][] = expirations.map((exp) => {
      // 1. Get raw IV values for all strikes at this expiry (using Out-of-the-Money selection for skew)
      const rawIvs = strikes.map((strike) => {
        const key = `${exp}_${strike}`
        const opts = optionsLookup.get(key) || []
        const callOpt = opts.find((o) => o.type === "C")
        const putOpt = opts.find((o) => o.type === "P")

        const callIv = callOpt?.iv || 0
        const putIv = putOpt?.iv || 0

        let selectedIv = 0
        if (strike < spotPrice) {
          // Put is OTM
          selectedIv = putIv > 0 ? putIv : callIv
        } else if (strike > spotPrice) {
          // Call is OTM
          selectedIv = callIv > 0 ? callIv : putIv
        } else {
          // ATM
          if (callIv > 0 && putIv > 0) {
            selectedIv = (callIv + putIv) / 2
          } else {
            selectedIv = callIv > 0 ? callIv : putIv
          }
        }

        return selectedIv > 0 ? selectedIv : null
      })

      // 2. Interpolate missing/null IV values across strikes (1D linear interpolation)
      const validIndices: number[] = []
      for (let i = 0; i < rawIvs.length; i++) {
        if (rawIvs[i] !== null && rawIvs[i]! > 0) {
          validIndices.push(i)
        }
      }

      if (validIndices.length === 0) {
        return strikes.map(() => 20) // Default fallback if no valid IV at all for this expiry
      }

      return strikes.map((strike, i) => {
        if (rawIvs[i] !== null && rawIvs[i]! > 0) {
          return rawIvs[i]!
        }

        // Find closest lower valid index
        let lowerIdx = -1
        for (let j = validIndices.length - 1; j >= 0; j--) {
          if (validIndices[j] < i) {
            lowerIdx = validIndices[j]
            break
          }
        }

        // Find closest upper valid index
        let upperIdx = -1
        for (let j = 0; j < validIndices.length; j++) {
          if (validIndices[j] > i) {
            upperIdx = validIndices[j]
            break
          }
        }

        if (lowerIdx !== -1 && upperIdx !== -1) {
          const x0 = strikes[lowerIdx]
          const x1 = strikes[upperIdx]
          const y0 = rawIvs[lowerIdx]!
          const y1 = rawIvs[upperIdx]!
          return y0 + ((y1 - y0) * (strike - x0)) / (x1 - x0)
        } else if (lowerIdx !== -1) {
          return rawIvs[lowerIdx]!
        } else if (upperIdx !== -1) {
          return rawIvs[upperIdx]!
        }
        return 20 // Default fallback
      })
    })

    const allZValues = z.flat()
    const zMin = allZValues.length > 0 ? Math.min(...allZValues) : 10
    const zMax = allZValues.length > 0 ? Math.max(...allZValues) : 40
    const zRange: [number, number] = [Math.max(0, zMin - 2), zMax + 2]

    return { x: strikes, y: expirations, z, zRange }
  }, [data, spotPrice, selectedExpiries])

  if (x.length === 0 || y.length < 2) {
    return (
      <div className="h-[500px] w-full flex flex-col items-center justify-center bg-black border border-[#1A1A1A] rounded p-6 text-center">
        <div className="max-w-md space-y-4">
          <div className="text-terminal-red text-xs font-mono font-semibold uppercase tracking-wider">
            [!] 3D SURFACE PLOT REQUIREMENT
          </div>
          <p className="text-xs text-[#B5B5B5] leading-relaxed font-mono">
            Plotly's 3D surface generator requires a minimum of 2 expiration dates to construct a mesh grid. Currently, only {y.length} expiry is active.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            {onModeChange && (
              <button
                onClick={() => onModeChange('90d')}
                className="px-3 py-1.5 rounded text-xs font-mono border border-terminal-green/30 bg-terminal-green/10 text-terminal-green hover:bg-terminal-green/20 transition-all"
              >
                Switch to 90D Preset
              </button>
            )}
            {onModeChange && onSelectedExpiriesChange && availableExpiries && (
              <button
                onClick={() => {
                  onModeChange('custom')
                  onSelectedExpiriesChange([...availableExpiries])
                }}
                className="px-3 py-1.5 rounded text-xs font-mono border border-[#333] hover:border-[#949494] text-[#E5E5E5] hover:bg-[#111] transition-all"
              >
                Select All Expiries
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full flex items-center justify-center bg-black rounded relative">
      {!plotLoaded && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="flex items-center gap-3 text-[#949494]">
            <div className="w-4 h-4 border-2 border-[#333] border-t-terminal-green rounded-full animate-spin" />
            <span className="text-xs font-mono">RENDERING SURFACE ({y.length} expiries × {x.length} strikes)...</span>
          </div>
        </div>
      )}
      <Plot
        data={[
          {
            type: "surface",
            x, y, z,
            colorscale: "Viridis", // A beautiful quantitative color scheme for volatility
            reversescale: false,
            colorbar: {
              title: "IV (%)",
              titleside: "right",
              titlefont: { color: colors.text.secondary, size: 11, family: typography.fontSans },
              tickfont: { color: colors.text.muted, size: 10, family: typography.fontMono },
            },
            showscale: false,
            cmin: zRange[0],
            cmax: zRange[1],
            name: "IV Surface"
          }
        ]}
        layout={{
          title: {
            text: `${ticker} IV Surface (3D) — ${y.length} Expiries × ${x.length} Strikes`,
            font: { color: colors.text.primary, family: typography.fontSans, size: 14 },
          },
          autosize: true,
          scene: {
            xaxis: {
              title: { text: "Strike Price", font: { color: colors.text.secondary, size: 11 } },
              gridcolor: chartTheme.grid,
              zerolinecolor: chartTheme.zeroLine,
            },
            yaxis: {
              title: { text: "Expiration", font: { color: colors.text.secondary, size: 11 } },
              gridcolor: chartTheme.grid,
              zerolinecolor: chartTheme.zeroLine,
            },
            zaxis: {
              title: { text: "Implied Volatility (%)", font: { color: colors.text.secondary, size: 11 } },
              range: zRange,
              zeroline: true,
              zerolinecolor: "rgba(255,255,255,0.4)",
              zerolinewidth: 2,
              gridcolor: chartTheme.grid,
            },
            bgcolor: chartTheme.surface.bg,
            camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } },
          },
          paper_bgcolor: chartTheme.surface.bg,
          plot_bgcolor: chartTheme.surface.bg,
          font: { color: colors.text.primary, family: typography.fontSans },
          margin: { l: 40, r: 40, b: 40, t: 40 },
        }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
        config={{
          displayModeBar: false,
          displaylogo: false,
          responsive: true
        }}
        onInitialized={() => setPlotLoaded(true)}
        onUpdate={() => setPlotLoaded(true)}
      />
    </div>
  )
}
