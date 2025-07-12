"use client"

import { useMemo, useState } from "react"
import type { OptionData } from "@/lib/types"
import dynamic from "next/dynamic"

// Lazy load Plotly only on the client
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false })

interface GEXSurfaceChartProps {
  data: OptionData[]
  ticker: string
  spotPrice: number
}

export function GEXSurfaceChart({ data, ticker, spotPrice }: GEXSurfaceChartProps) {
  const [plotLoaded, setPlotLoaded] = useState(false)
  // Prepare data for 3D surface plot
  const { x, y, z, zRange } = useMemo(() => {
    const oneYear = new Date()
    oneYear.setFullYear(oneYear.getFullYear() + 1)
    const filtered = data.filter(
      (option) => option.expiration < oneYear && option.strike > spotPrice * 0.8 && option.strike < spotPrice * 1.2,
    )
    // Group by expiration (Y) and strike (X)
    const expirations = Array.from(new Set(filtered.map((o) => o.expiration.toISOString().split("T")[0]))).sort()
    const strikes = Array.from(new Set(filtered.map((o) => o.strike))).sort((a, b) => a - b)
    
    // Build Z matrix (GEX) - converting to millions for better readability
    const z: number[][] = expirations.map((exp) =>
      strikes.map((strike) => {
        const match = filtered.find((o) => o.expiration.toISOString().split("T")[0] === exp && o.strike === strike)
        if (!match) return 0
        
        // Ensure GEX is calculated if not present
        let gexValue = match.GEX
        if (typeof gexValue !== 'number') {
          // Calculate GEX: spot * gamma * open_interest * CONTRACT_SIZE * spot * 0.01
          const CONTRACT_SIZE = 100
          gexValue = spotPrice * match.gamma * match.open_interest * CONTRACT_SIZE * spotPrice * 0.01
          // For puts, make it negative (dealer perspective)
          if (match.type === "P") {
            gexValue = -gexValue
          }
        }
        
        return gexValue / 1e6 // Convert to millions
      }),
    )
    
    // Calculate z-axis range to ensure negative values are properly displayed
    const allZValues = z.flat() // Include zeros for proper centering
    const zMin = allZValues.length > 0 ? Math.min(...allZValues) : -1
    const zMax = allZValues.length > 0 ? Math.max(...allZValues) : 1
    
    // Create symmetric range around zero for better visualization
    const maxAbsValue = Math.max(Math.abs(zMin), Math.abs(zMax), 0.1) // Minimum range of 0.1
    const padding = maxAbsValue * 0.15 // 15% padding for better visibility
    const zRange: [number, number] = [
      -(maxAbsValue + padding), // Force negative range
      (maxAbsValue + padding)   // Force positive range
    ]
    
    // Debug log to check if we have negative values
    if (process.env.NODE_ENV === 'development') {
      console.log('GEX Surface Data:', {
        totalValues: allZValues.length,
        negativeValues: allZValues.filter(v => v < 0).length,
        positiveValues: allZValues.filter(v => v > 0).length,
        zeroValues: allZValues.filter(v => v === 0).length,
        zMin,
        zMax,
        maxAbsValue: Math.max(Math.abs(zMin), Math.abs(zMax)),
        zRange,
        sampleNegativeValues: allZValues.filter(v => v < 0).slice(0, 5),
        samplePositiveValues: allZValues.filter(v => v > 0).slice(0, 5)
      })
    }
    
    return { x: strikes, y: expirations, z, zRange }
  }, [data, spotPrice])

  return (
    <div className="h-full w-full flex items-center justify-center bg-[#212946] rounded-lg relative">
      {!plotLoaded && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-400"></div>
        </div>
      )}
      <Plot
        data={[
          {
            type: "surface",
            x,
            y,
            z,
            colorscale: "RdBu",
            reversescale: false, // Blue for negative (puts), Red for positive (calls)
            colorbar: { 
              title: "Gamma (M$ / %)",
              titleside: "right",
              tickmode: "linear",
              dtick: Math.max(0.1, Math.abs(zRange[1] - zRange[0]) / 10) // Better tick spacing
            },
            showscale: true,
            cmin: zRange[0], // Explicit color range minimum
            cmax: zRange[1], // Explicit color range maximum
            cmid: 0, // Center the colorscale at zero
            name: "GEX Surface"
          },
          // Add a zero reference plane for better visualization
          {
            type: "surface",
            x: [Math.min(...x), Math.max(...x)],
            y: [y[0], y[y.length - 1]],
            z: [[0, 0], [0, 0]], // Zero plane
            opacity: 0.3,
            colorscale: [[0, "rgba(128,128,128,0.3)"], [1, "rgba(128,128,128,0.3)"]],
            showscale: false,
            name: "Zero Reference",
            hoverinfo: "skip"
          }
        ]}
        layout={{
          title: `${ticker} GEX Surface (3D)`,
          autosize: true,
          scene: {
            xaxis: { title: "Strike Price" },
            yaxis: { title: "Expiration Date" },
            zaxis: { 
              title: "Gamma (M$ / %)",
              range: zRange, // Explicit z-axis range to show negative values
              zeroline: true, // Show zero line
              zerolinecolor: "rgba(255,255,255,0.8)",
              zerolinewidth: 2,
              tickmode: "linear",
              dtick: Math.max(0.5, Math.abs(zRange[1] - zRange[0]) / 8) // Better tick spacing
            },
            bgcolor: "#212946",
            camera: {
              eye: { x: 1.5, y: 1.5, z: 1.2 } // Better default viewing angle
            }
          },
          paper_bgcolor: "#212946",
          plot_bgcolor: "#212946",
          font: { color: "#FFF" },
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
