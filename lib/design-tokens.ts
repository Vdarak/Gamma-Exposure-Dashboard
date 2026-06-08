/**
 * Design Tokens — Single source of truth for the terminal UI.
 *
 * Every visual constant lives here. Components import from this file
 * instead of hardcoding hex values. Changing a token here updates
 * the entire application.
 */

// ─── Semantic Color System ────────────────────────────────────────

export const colors = {
  // Backgrounds (pitch-black hierarchy)
  bg: {
    root: '#000000',       // Page background — true black
    surface: '#0A0A0A',    // Card / panel background
    elevated: '#111111',   // Hover states, active panels
    input: '#0D0D0D',      // Input fields
    overlay: '#080808',    // Modals, dropdowns
  },

  // Borders (subtle structure)
  border: {
    default: '#1A1A1A',    // Standard borders
    subtle: '#141414',     // Dividers within panels
    active: '#333333',     // Focus / active borders
    accent: '#2A2A2A',     // Slightly brighter for emphasis
  },

  // Text hierarchy
  text: {
    primary: '#E5E5E5',    // Primary content
    secondary: '#737373',  // Labels, descriptions
    muted: '#525252',      // Timestamps, tertiary info
    inverse: '#000000',    // Text on bright backgrounds
    bright: '#FFFFFF',     // Maximum contrast (hero numbers)
  },

  // Semantic accents (sharp, terminal-inspired)
  accent: {
    green: '#00FF88',      // Calls, bullish, positive GEX
    red: '#FF3B3B',        // Puts, bearish, negative GEX
    cyan: '#00D4FF',       // Volume, informational
    amber: '#FFB800',      // Spot price reference
    magenta: '#FF00AA',    // Gamma flip level
    purple: '#8B5CF6',     // Pricing method, secondary actions
  },

  // Muted versions for fills / chart backgrounds
  accentMuted: {
    green: 'rgba(0, 255, 136, 0.12)',
    red: 'rgba(255, 59, 59, 0.12)',
    cyan: 'rgba(0, 212, 255, 0.12)',
    amber: 'rgba(255, 184, 0, 0.12)',
    magenta: 'rgba(255, 0, 170, 0.12)',
    purple: 'rgba(139, 92, 246, 0.12)',
  },

  // Semi-transparent versions for chart bar fills
  accentAlpha: {
    green50: 'rgba(0, 255, 136, 0.50)',
    green30: 'rgba(0, 255, 136, 0.30)',
    red50: 'rgba(255, 59, 59, 0.50)',
    red30: 'rgba(255, 59, 59, 0.30)',
    cyan40: 'rgba(0, 212, 255, 0.40)',
    cyan20: 'rgba(0, 212, 255, 0.20)',
    amber50: 'rgba(255, 184, 0, 0.50)',
    magenta50: 'rgba(255, 0, 170, 0.50)',
    purple50: 'rgba(139, 92, 246, 0.50)',
  },
} as const

// ─── Chart Theme ──────────────────────────────────────────────────

export const chartTheme = {
  // Grid & axes
  grid: '#1A1A1A',
  gridSubtle: '#111111',
  axisLabel: '#737373',
  axisTick: '#525252',
  zeroLine: '#2A2A2A',

  // Tooltip
  tooltip: {
    bg: '#111111',
    border: '#1A1A1A',
    text: '#E5E5E5',
    textMuted: '#737373',
  },

  // Bar chart colors
  bar: {
    positive: colors.accent.green,
    negative: colors.accent.red,
    positiveFill: colors.accentAlpha.green50,
    negativeFill: colors.accentAlpha.red50,
    volume: colors.accent.cyan,
    volumeFill: colors.accentAlpha.cyan40,
    callFill: colors.accentAlpha.green30,
    putFill: colors.accentAlpha.red30,
  },

  // Line chart colors
  line: {
    spot: colors.accent.amber,
    upper: colors.accent.green,
    lower: colors.accent.red,
    total: colors.accent.purple,
    net: colors.accent.green,
    gammaFlip: colors.accent.magenta,
  },

  // Reference annotations
  annotation: {
    spot: { color: colors.accent.amber, dash: [6, 4] as number[] },
    gammaFlip: { color: colors.accent.magenta, dash: [4, 4] as number[] },
    zero: { color: '#2A2A2A', dash: [2, 2] as number[] },
  },

  // 3D surface
  surface: {
    colorscale: [
      [0.0, '#FF3B3B'],    // Red (Negative GEX)
      [0.25, '#FF8800'],   // Orange
      [0.5, '#FFD700'],    // Yellow (Near Zero)
      [0.75, '#00D4FF'],   // Cyan
      [1.0, '#00FF88'],    // Green (Positive GEX)
    ] as [number, string][],
    bg: '#000000',
  },

  // Gauge
  gauge: {
    trackBg: '#1A1A1A',
    needleWidth: 2,
    arcWidth: 6,
  },
} as const

// ─── Typography ───────────────────────────────────────────────────

export const typography = {
  fontMono: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  fontSans: '"Inter", system-ui, -apple-system, sans-serif',

  // Size scale
  sizes: {
    xs: '0.6875rem',     // 11px — timestamps, tertiary
    sm: '0.75rem',       // 12px — labels, descriptions
    base: '0.8125rem',   // 13px — body text, data values
    lg: '0.9375rem',     // 15px — section headers
    xl: '1.125rem',      // 18px — panel titles
    '2xl': '1.5rem',     // 24px — page header
    '3xl': '2rem',       // 32px — hero numbers
  },

  // Weight
  weights: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },

  // Letter spacing
  tracking: {
    tight: '-0.01em',
    normal: '0',
    wide: '0.05em',
    wider: '0.1em',
  },
} as const

// ─── Spacing (8px grid) ──────────────────────────────────────────

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
  '3xl': '48px',

  // Semantic
  panelPadding: '16px',
  sectionGap: '24px',
  gridGap: '12px',
  inlineGap: '8px',
} as const

// ─── Border Radius ───────────────────────────────────────────────

export const radius = {
  none: '0',
  sm: '2px',
  md: '4px',
  lg: '6px',
  full: '9999px',
} as const

// ─── Transitions ─────────────────────────────────────────────────

export const transitions = {
  fast: '150ms ease',
  default: '200ms ease',
  slow: '300ms ease',
} as const
