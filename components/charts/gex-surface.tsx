"use client"

import { useEffect, useRef } from "react"
import { Chart as ChartJS, LinearScale, PointElement, LineElement, Tooltip, Legend } from "chart.js"

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend)

interface GexSurfaceProps {
  ticker: string
}

export function GexSurface({ ticker }: GexSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return

    const ctx = canvasRef.current.getContext("2d")
    if (!ctx) return

    // In a real implementation, this would render a 3D surface plot
    // For now, we'll just display a message
    ctx.fillStyle = "#212946"
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height)

    ctx.font = "20px Arial"
    ctx.fillStyle = "#FFF"
    ctx.textAlign = "center"
    ctx.fillText(`${ticker} 3D Gamma Exposure Surface`, canvasRef.current.width / 2, 50)

    ctx.font = "16px Arial"
    ctx.fillText(
      "This would display a 3D surface plot of gamma exposure",
      canvasRef.current.width / 2,
      canvasRef.current.height / 2 - 20,
    )
    ctx.fillText(
      "across strike prices and expiration dates.",
      canvasRef.current.width / 2,
      canvasRef.current.height / 2 + 20,
    )

    // Draw axes
    ctx.strokeStyle = "#FFF"
    ctx.lineWidth = 2

    // X-axis (Strike)
    ctx.beginPath()
    ctx.moveTo(50, canvasRef.current.height - 50)
    ctx.lineTo(canvasRef.current.width - 50, canvasRef.current.height - 50)
    ctx.stroke()

    // Y-axis (Expiration)
    ctx.beginPath()
    ctx.moveTo(50, 50)
    ctx.lineTo(50, canvasRef.current.height - 50)
    ctx.stroke()

    // Z-axis (GEX)
    ctx.beginPath()
    ctx.moveTo(50, canvasRef.current.height - 50)
    ctx.lineTo(150, canvasRef.current.height - 150)
    ctx.stroke()

    // Labels
    ctx.font = "14px Arial"
    ctx.fillText("Strike", canvasRef.current.width - 50, canvasRef.current.height - 30)
    ctx.fillText("Expiration", 30, 40)
    ctx.fillText("GEX", 120, canvasRef.current.height - 160)
  }, [ticker])

  return (
    <div className="h-full w-full flex items-center justify-center bg-[#212946]">
      <canvas ref={canvasRef} width={800} height={500} />
    </div>
  )
}
