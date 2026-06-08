/**
 * D3.js Helper Utilities
 *
 * Shared functions for consistent axis rendering, tooltips,
 * and color scales across all D3-based chart components.
 */

import * as d3 from 'd3'
import { colors, chartTheme, typography } from './design-tokens'

// ─── Axis Styling ─────────────────────────────────────────────────

/**
 * Apply terminal-style formatting to a D3 axis group.
 * Removes the domain line, styles tick text in monospace,
 * and colors gridlines to match design tokens.
 */
export function styleAxis(
  axisGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  opts?: { hideDomain?: boolean; tickColor?: string; fontSize?: number }
) {
  const { hideDomain = true, tickColor = colors.text.muted, fontSize = 10 } = opts || {}

  if (hideDomain) {
    axisGroup.select('.domain').attr('stroke', chartTheme.grid)
  }

  axisGroup
    .selectAll('.tick line')
    .attr('stroke', chartTheme.gridSubtle)

  axisGroup
    .selectAll('.tick text')
    .attr('fill', tickColor)
    .style('font-family', typography.fontMono)
    .style('font-size', `${fontSize}px`)
}

// ─── Grid Lines ───────────────────────────────────────────────────

export function drawGridLinesX(
  svg: d3.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3.ScaleLinear<number, number>,
  height: number,
  ticks?: number
) {
  const tickValues = scale.ticks(ticks || 6)
  svg
    .selectAll('.grid-line-x')
    .data(tickValues)
    .join('line')
    .attr('class', 'grid-line-x')
    .attr('x1', d => scale(d))
    .attr('x2', d => scale(d))
    .attr('y1', 0)
    .attr('y2', height)
    .attr('stroke', chartTheme.gridSubtle)
    .attr('stroke-dasharray', '2,2')
}

export function drawGridLinesY(
  svg: d3.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3.ScaleLinear<number, number>,
  width: number,
  ticks?: number
) {
  const tickValues = scale.ticks(ticks || 6)
  svg
    .selectAll('.grid-line-y')
    .data(tickValues)
    .join('line')
    .attr('class', 'grid-line-y')
    .attr('x1', 0)
    .attr('x2', width)
    .attr('y1', d => scale(d))
    .attr('y2', d => scale(d))
    .attr('stroke', chartTheme.gridSubtle)
    .attr('stroke-dasharray', '2,2')
}

// ─── Reference Lines ──────────────────────────────────────────────

export function drawHorizontalRefLine(
  svg: d3.Selection<SVGGElement, unknown, null, undefined>,
  y: number,
  width: number,
  color: string,
  label: string,
  opts?: { dashArray?: string; labelSide?: 'left' | 'right' }
) {
  const { dashArray = '6,4', labelSide = 'right' } = opts || {}

  svg
    .append('line')
    .attr('class', 'ref-line')
    .attr('x1', 0)
    .attr('x2', width)
    .attr('y1', y)
    .attr('y2', y)
    .attr('stroke', color)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', dashArray)
    .attr('opacity', 0.8)

  svg
    .append('text')
    .attr('class', 'ref-label')
    .attr('x', labelSide === 'right' ? width - 4 : 4)
    .attr('y', y - 4)
    .attr('text-anchor', labelSide === 'right' ? 'end' : 'start')
    .attr('fill', color)
    .style('font-family', typography.fontMono)
    .style('font-size', '9px')
    .style('font-weight', '600')
    .text(label)
}

export function drawVerticalRefLine(
  svg: d3.Selection<SVGGElement, unknown, null, undefined>,
  x: number,
  height: number,
  color: string,
  label: string,
  opts?: { dashArray?: string }
) {
  const { dashArray = '6,4' } = opts || {}

  svg
    .append('line')
    .attr('class', 'ref-line')
    .attr('x1', x)
    .attr('x2', x)
    .attr('y1', 0)
    .attr('y2', height)
    .attr('stroke', color)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', dashArray)
    .attr('opacity', 0.8)

  svg
    .append('text')
    .attr('class', 'ref-label')
    .attr('x', x + 4)
    .attr('y', 12)
    .attr('fill', color)
    .style('font-family', typography.fontMono)
    .style('font-size', '9px')
    .style('font-weight', '600')
    .text(label)
}

// ─── Color Scales ─────────────────────────────────────────────────

/** Returns green for positive, red for negative GEX values */
export function gexColor(value: number): string {
  return value >= 0 ? colors.accent.green : colors.accent.red
}

export function gexFillColor(value: number): string {
  return value >= 0 ? colors.accentAlpha.green50 : colors.accentAlpha.red50
}

/** Heatmap color scale for surface visualization */
export function createHeatmapScale(domain: [number, number]) {
  return d3
    .scaleSequential()
    .domain(domain)
    .interpolator(d3.interpolateRgbBasis([
      colors.accent.red,     // Negative
      '#FF8800',             // Orange
      '#FFD700',             // Yellow (zero)
      colors.accent.cyan,    // Cyan
      colors.accent.green,   // Positive
    ]))
}

// ─── Number Formatting ────────────────────────────────────────────

export function formatBillions(n: number): string {
  const abs = Math.abs(n)
  const sign = n >= 0 ? '+' : '-'
  if (abs >= 1) return `${sign}${abs.toFixed(2)}B`
  if (abs >= 0.001) return `${sign}${(abs * 1000).toFixed(1)}M`
  return `${sign}${(abs * 1e6).toFixed(0)}K`
}

export function formatCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(0)
}

// ─── Tooltip Helper ───────────────────────────────────────────────

export function positionTooltip(
  tooltip: HTMLDivElement,
  event: MouseEvent,
  containerRect: DOMRect
) {
  const x = event.clientX - containerRect.left
  const y = event.clientY - containerRect.top

  const tipWidth = tooltip.offsetWidth
  const tipHeight = tooltip.offsetHeight

  let left = x + 12
  let top = y - tipHeight / 2

  // Flip if near right edge
  if (left + tipWidth > containerRect.width) {
    left = x - tipWidth - 12
  }
  // Clamp vertical
  if (top < 0) top = 4
  if (top + tipHeight > containerRect.height) top = containerRect.height - tipHeight - 4

  tooltip.style.left = `${left}px`
  tooltip.style.top = `${top}px`
}

// ─── Margins ──────────────────────────────────────────────────────

export const DEFAULT_MARGINS = {
  top: 24,
  right: 24,
  bottom: 48,
  left: 64,
}

export const HORIZONTAL_MARGINS = {
  top: 24,
  right: 24,
  bottom: 32,
  left: 80,
}
