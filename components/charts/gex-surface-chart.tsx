"use client"

import { useMemo, useState } from "react"
import type { OptionData } from "@/lib/types"
import dynamic from "next/dynamic"
import { colors, chartTheme, typography } from "@/lib/design-tokens"

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false })

interface GEXSurfaceChartProps {
  data: OptionData[]
  ticker: string
  spotPrice: number
}

export function GEXSurfaceChart({ data, ticker, spotPrice }: GEXSurfaceChartProps) {
  const [plotLoaded, setPlotLoaded] = useState(false)

  const { x, y, z, zRange } = useMemo(() => {
    const oneYear = new Date()
    oneYear.setFullYear(oneYear.getFullYear() + 1)
    const filtered = data.filter(
      (option) => option.expiration < oneYear && option.strike > spotPrice * 0.8 && option.strike < spotPrice * 1.2,
    )

    const expirations = Array.from(new Set(filtered.map((o) => o.expiration.toISOString().split("T")[0]))).sort()
    const strikes = Array.from(new Set(filtered.map((o) => o.strike))).sort((a, b) => a - b)
    
    const z: number[][] = expirations.map((exp) =>
      strikes.map((strike) => {
        const match = filtered.find((o) => o.expiration.toISOString().split("T")[0] === exp && o.strike === strike)
        if (!match) return 0
        
        let gexValue = match.GEX
        if (typeof gexValue !== 'number') {
          const CONTRACT_SIZE = 100
          gexValue = spotPrice * match.gamma * match.open_interest * CONTRACT_SIZE * spotPrice * 0.01
          if (match.type === "P") gexValue = -gexValue
        }
        
        return gexValue / 1e6
      }),
    )
    
    const allZValues = z.flat()
    const zMin = allZValues.length > 0 ? Math.min(...allZValues) : -1
    const zMax = allZValues.length > 0 ? Math.max(...allZValues) : 1
    const maxAbsValue = Math.max(Math.abs(zMin), Math.abs(zMax), 0.1)
    const padding = maxAbsValue * 0.15
    const zRange: [number, number] = [-(maxAbsValue + padding), (maxAbsValue + padding)]
    
    return { x: strikes, y: expirations, z, zRange }
  }, [data, spotPrice])

  return (
    <div className="h-full w-full flex items-center justify-center bg-black rounded relative">
      {!plotLoaded && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="flex items-center gap-3 text-[#525252]">
            <div className="w-4 h-4 border-2 border-[#333] border-t-terminal-green rounded-full animate-spin" />
            <span className="text-xs font-mono">RENDERING SURFACE...</span>
          </div>
        </div>
      )}
      <Plot
        data={[
          {
            type: "surface",
            x, y, z,
            colorscale: chartTheme.surface.colorscale,
            reversescale: false,
            colorbar: { 
              title: "Gamma (M$ / %)",
              titleside: "right",
              titlefont: { color: colors.text.secondary, size: 11, family: typography.fontSans },
              tickfont: { color: colors.text.muted, size: 10, family: typography.fontMono },
            },
            showscale: true,
            cmin: zRange[0],
            cmax: zRange[1],
            cmid: 0,
            name: "GEX Surface"
          },
          {
            type: "surface",
            x: [Math.min(...x), Math.max(...x)],
            y: [y[0], y[y.length - 1]],
            z: [[0, 0], [0, 0]],
            opacity: 0.2,
            colorscale: [[0, "rgba(255,255,255,0.1)"], [1, "rgba(255,255,255,0.1)"]],
            showscale: false,
            name: "Zero Reference",
            hoverinfo: "skip"
          }
        ]}
        layout={{
          title: {
            text: `${ticker} GEX Surface (3D)`,
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
              title: { text: "Gamma (M$ / %)", font: { color: colors.text.secondary, size: 11 } },
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
        style={{ width: "100%", height: "500px" }}
        config={{ responsive: true }}
        onInitialized={() => setPlotLoaded(true)}
        onUpdate={() => setPlotLoaded(true)}
      />
    </div>
  )
}
