/**
 * Shared Chart.js configuration factory.
 *
 * Every chart imports from here to get consistent styling.
 * No chart component should hardcode colors, fonts, or grid settings.
 */

import type { ChartOptions } from 'chart.js'
import { colors, chartTheme, typography } from './design-tokens'

// ─── Base options shared by ALL chart types ───────────────────────

function createBasePlugins(title: string) {
  return {
    legend: {
      display: true,
      position: 'top' as const,
      labels: {
        color: colors.text.secondary,
        font: { family: typography.fontSans, size: 11 },
        usePointStyle: true,
        pointStyle: 'rect' as const,
        padding: 16,
      },
    },
    title: {
      display: !!title,
      text: title,
      color: colors.text.primary,
      font: { family: typography.fontSans, size: 14, weight: 'bold' as const },
      padding: { top: 8, bottom: 16 },
    },
    tooltip: {
      backgroundColor: chartTheme.tooltip.bg,
      titleColor: chartTheme.tooltip.text,
      bodyColor: chartTheme.tooltip.text,
      borderColor: chartTheme.tooltip.border,
      borderWidth: 1,
      padding: 10,
      displayColors: true,
      titleFont: { family: typography.fontSans, size: 12 },
      bodyFont: { family: typography.fontMono, size: 11 },
      cornerRadius: 4,
    },
  }
}

function createXScale(label?: string) {
  return {
    grid: { color: chartTheme.gridSubtle, drawTicks: false },
    ticks: {
      color: colors.text.muted,
      font: { family: typography.fontMono, size: 10 },
      padding: 6,
    },
    title: label ? {
      display: true,
      text: label,
      color: colors.text.secondary,
      font: { family: typography.fontSans, size: 11, weight: 'normal' as const },
      padding: { top: 8 },
    } : undefined,
    border: { color: chartTheme.grid },
  }
}

function createYScale(label?: string) {
  return {
    grid: { color: chartTheme.gridSubtle, drawTicks: false },
    ticks: {
      color: colors.text.muted,
      font: { family: typography.fontMono, size: 10 },
      padding: 6,
    },
    title: label ? {
      display: true,
      text: label,
      color: colors.text.secondary,
      font: { family: typography.fontSans, size: 11, weight: 'normal' as const },
      padding: { bottom: 8 },
    } : undefined,
    border: { color: chartTheme.grid },
  }
}

// ─── Bar Chart Options ────────────────────────────────────────────

export function createBarChartOptions(
  title: string,
  opts?: {
    horizontal?: boolean
    xLabel?: string
    yLabel?: string
    stacked?: boolean
  }
): ChartOptions<'bar'> {
  const { horizontal = false, xLabel, yLabel, stacked = false } = opts || {}

  return {
    indexAxis: horizontal ? 'y' : 'x',
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: { top: 8, right: 16, bottom: 8, left: 16 },
    },
    plugins: createBasePlugins(title),
    scales: {
      x: {
        ...createXScale(xLabel),
        stacked,
      },
      y: {
        ...createYScale(yLabel),
        stacked,
      },
    },
  }
}

// ─── Horizontal Bar (GEX-style) ──────────────────────────────────

export function createHorizontalBarOptions(
  title: string,
  opts?: {
    xLabel?: string
    yLabel?: string
    xMin?: number
    xMax?: number
    yReverse?: boolean
  }
): ChartOptions<'bar'> {
  const { xLabel, yLabel, xMin, xMax, yReverse = true } = opts || {}

  return {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: { top: 8, right: 16, bottom: 8, left: 16 },
    },
    plugins: createBasePlugins(title),
    scales: {
      x: {
        ...createXScale(xLabel),
        min: xMin,
        max: xMax,
      },
      y: {
        ...createYScale(yLabel),
        reverse: yReverse,
        ticks: {
          color: colors.text.muted,
          font: { family: typography.fontMono, size: 10 },
          maxTicksLimit: 14,
          padding: 6,
          autoSkip: true,
        },
      },
    },
  }
}

// ─── Line Chart Options ──────────────────────────────────────────

export function createLineChartOptions(
  title: string,
  opts?: {
    xLabel?: string
    yLabel?: string
    xTime?: boolean
    timeUnit?: 'day' | 'week' | 'month'
  }
): ChartOptions<'line'> {
  const { xLabel, yLabel, xTime = false, timeUnit = 'month' } = opts || {}

  const xScale = xTime ? {
    type: 'time' as const,
    time: {
      unit: timeUnit,
      tooltipFormat: 'yyyy-MM-dd',
      displayFormats: {
        day: 'MMM dd',
        week: 'MMM dd',
        month: 'MMM yyyy',
      },
    },
    grid: { color: chartTheme.gridSubtle, drawTicks: false },
    ticks: {
      color: colors.text.muted,
      font: { family: typography.fontMono, size: 10 },
      maxRotation: 45,
      minRotation: 45,
      source: 'auto' as const,
    },
    title: xLabel ? {
      display: true,
      text: xLabel,
      color: colors.text.secondary,
      font: { family: typography.fontSans, size: 11, weight: 'normal' as const },
    } : undefined,
    border: { color: chartTheme.grid },
  } : createXScale(xLabel)

  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: { top: 8, right: 16, bottom: 8, left: 16 },
    },
    plugins: createBasePlugins(title),
    scales: {
      x: xScale,
      y: createYScale(yLabel),
    },
  }
}

// ─── Plotly layout for 3D surface ────────────────────────────────

export function createSurfaceLayout(title: string, zRange: [number, number]) {
  return {
    title: {
      text: title,
      font: { color: colors.text.primary, family: typography.fontSans, size: 14 },
    },
    autosize: true,
    scene: {
      xaxis: {
        title: { text: 'Strike Price', font: { color: colors.text.secondary, size: 11 } },
        gridcolor: chartTheme.grid,
        zerolinecolor: chartTheme.zeroLine,
      },
      yaxis: {
        title: { text: 'Expiration', font: { color: colors.text.secondary, size: 11 } },
        gridcolor: chartTheme.grid,
        zerolinecolor: chartTheme.zeroLine,
      },
      zaxis: {
        title: { text: 'Gamma (M$ / %)', font: { color: colors.text.secondary, size: 11 } },
        range: zRange,
        zeroline: true,
        zerolinecolor: 'rgba(255,255,255,0.4)',
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
  }
}

// ─── Dataset color helpers ───────────────────────────────────────

export function getGEXBarColors(values: number[]) {
  return {
    backgroundColor: values.map(v =>
      v >= 0 ? chartTheme.bar.positiveFill : chartTheme.bar.negativeFill
    ),
    borderColor: values.map(v =>
      v >= 0 ? chartTheme.bar.positive : chartTheme.bar.negative
    ),
  }
}

export function getVolumeBarColors() {
  return {
    backgroundColor: chartTheme.bar.volumeFill,
    borderColor: chartTheme.bar.volume,
  }
}
