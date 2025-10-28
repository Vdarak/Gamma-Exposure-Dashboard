"use client"

import { useEffect, useRef } from "react"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartConfiguration,
  type ChartOptions,
  type ChartType,
} from "chart.js"
import annotationPlugin from "chartjs-plugin-annotation"

// Register Chart.js components globally (done once)
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  annotationPlugin
)

export interface ChartWrapperProps<T extends ChartType = ChartType> {
  type: T
  data: ChartConfiguration<T>["data"]
  options?: ChartConfiguration<T>["options"]
  height?: number | string
  width?: number | string
  className?: string
  onElementClick?: (elements: any[], event: any) => void
}

/**
 * ChartWrapper - A unified wrapper for Chart.js charts
 * 
 * Features:
 * - Automatic registration of Chart.js controllers and plugins
 * - Responsive resizing with aspect ratio support
 * - Consistent theme colors from Tailwind CSS variables
 * - Shared tooltip formatting
 * - Click event handling
 * - Memory leak prevention with proper cleanup
 */
export function ChartWrapper<T extends ChartType = ChartType>({
  type,
  data,
  options = {},
  height,
  width,
  className = "",
  onElementClick,
}: ChartWrapperProps<T>) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<ChartJS | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return

    const ctx = canvasRef.current.getContext("2d")
    if (!ctx) return

    // Get CSS variable colors for dark mode support
    const getThemeColor = (variable: string) => {
      if (typeof window !== "undefined") {
        return getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
      }
      return "#666"
    }

    // Default options with theme support
    const defaultOptions: ChartOptions = {
      responsive: true,
      maintainAspectRatio: !height,
      plugins: {
        legend: {
          labels: {
            color: getThemeColor("--foreground") || "#e5e7eb",
            font: {
              family: "system-ui, sans-serif",
            },
          },
        },
        tooltip: {
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          titleColor: "#fff",
          bodyColor: "#e5e7eb",
          borderColor: "rgba(255, 255, 255, 0.1)",
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          callbacks: {
            // Add custom number formatting
            label: function (context: any) {
              let label = context.dataset.label || ""
              if (label) {
                label += ": "
              }
              if (context.parsed.y !== null) {
                const value = context.parsed.y
                // Format large numbers with abbreviations
                if (Math.abs(value) >= 1e9) {
                  label += (value / 1e9).toFixed(2) + "B"
                } else if (Math.abs(value) >= 1e6) {
                  label += (value / 1e6).toFixed(2) + "M"
                } else if (Math.abs(value) >= 1e3) {
                  label += (value / 1e3).toFixed(2) + "K"
                } else {
                  label += value.toFixed(2)
                }
              }
              return label
            },
          },
        },
      },
      scales:
        type === "bar" || type === "line"
          ? {
              x: {
                grid: {
                  color: "rgba(255, 255, 255, 0.05)",
                },
                ticks: {
                  color: getThemeColor("--muted-foreground") || "#9ca3af",
                },
              },
              y: {
                grid: {
                  color: "rgba(255, 255, 255, 0.05)",
                },
                ticks: {
                  color: getThemeColor("--muted-foreground") || "#9ca3af",
                },
              },
            }
          : undefined,
      onClick: onElementClick
        ? (event, elements) => {
            if (elements.length > 0) {
              onElementClick(elements, event)
            }
          }
        : undefined,
    }

    // Deep merge options
    const mergedOptions = {
      ...defaultOptions,
      ...options,
      plugins: {
        ...defaultOptions.plugins,
        ...options.plugins,
      },
      scales: {
        ...defaultOptions.scales,
        ...(options.scales || {}),
      },
    }

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.destroy()
    }

    // Create new chart
    chartRef.current = new ChartJS(ctx, {
      type,
      data,
      options: mergedOptions,
    })

    // Cleanup on unmount
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [type, data, options, onElementClick, height])

  return (
    <div className={`relative ${className}`} style={{ height, width }}>
      <canvas ref={canvasRef} />
    </div>
  )
}
