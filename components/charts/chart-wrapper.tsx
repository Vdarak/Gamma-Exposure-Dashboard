"use client"

import type React from "react"

interface ChartWrapperProps {
  title: string
  subtitle?: string
  controls?: React.ReactNode
  height?: string
  children: React.ReactNode
  loading?: boolean
  emptyMessage?: string
}

export function ChartWrapper({
  title,
  subtitle,
  controls,
  height = "500px",
  children,
  loading = false,
  emptyMessage,
}: ChartWrapperProps) {
  return (
    <div className="panel">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-4 pt-4 pb-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-[#E5E5E5]">{title}</h3>
          {subtitle && (
            <p className="text-xxs text-[#525252]">{subtitle}</p>
          )}
        </div>
        {controls && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {controls}
          </div>
        )}
      </div>

      {/* Chart area */}
      <div className="px-4 pb-4" style={{ height }}>
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex items-center gap-3 text-[#525252]">
              <div className="w-4 h-4 border-2 border-[#333] border-t-terminal-green rounded-full animate-spin" />
              <span className="text-xs font-mono">LOADING...</span>
            </div>
          </div>
        ) : emptyMessage ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-xs font-mono text-[#333]">{emptyMessage}</span>
          </div>
        ) : (
          <div className="h-full w-full">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
