/**
 * Chart configuration — Plotly layout factory.
 *
 * Chart.js-specific factories have been removed in favor of D3.js.
 * This module now provides only the Plotly 3D surface layout helper.
 *
 * For D3 helpers, see ./d3-helpers.ts
 */

import { colors, chartTheme, typography } from './design-tokens'

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
