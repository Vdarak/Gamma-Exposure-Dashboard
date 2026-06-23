# Frontend Architecture

This document serves as the bottom-up reference for the Next.js frontend of the Gamma Exposure Terminal Dashboard.

---

## 💻 Tech Stack & Client Technologies

* **Core Framework**: React 19 + Next.js 15 (App Router).
* **Styling**: TailwindCSS 3 + CSS Variables mapping to light/dark themes.
* **Component Library**: Primitive components built via Radix UI (accordion, dialog, drop-down, select, slider, popover, tabs, tooltips) integrated with Tailwind CSS (equivalent to shadcn/ui).
* **Visualization Layer**:
  * **Chart.js / React-Chartjs-2**: High-performance rendering of strike grids, walls, and options distributions.
  * **Plotly.js**: Dynamic 3D graphics for Volatility (IV) and Gamma Surface analysis.
  * **D3.js**: Custom SVG layouts and tick managers for synced axes.

---

## 🛣️ Layout & Routing Structure

The project uses Next.js App Router layout conventions:

* **[app/layout.tsx](../app/layout.tsx)**:
  * Injects fonts: `Inter` (sans-serif) and `JetBrains Mono` (monospace for pricing numbers/tabular data).
  * Wraps the application in a custom [ThemeProvider](../components/theme-provider.tsx) specifying `class` selection for dark mode toggles.
* **[app/page.tsx](../app/page.tsx)**:
  * Mounts the main [GammaExposureDashboard](../components/gamma-exposure-dashboard.tsx) component.
* **Next.js Serverless API Routes**:
  * **[app/api/options/[ticker]/route.ts](../app/api/options/%5Bticker%5D/route.ts)**: Acts as a real-time proxy that fetches option chain data directly from CBOE CDN, falling back to Yahoo Finance to fetch spot prices if CBOE fails.
  * **[app/api/options/india/[ticker]/route.ts](../app/api/options/india/%5Bticker%5D/route.ts)**: Fetches and parses Indian market option chains (NSE).

---

## ⚡ Client Data Services & Client-Side Cache

The frontend accesses data via two client services:

### 1. DataService (`lib/data-service.ts`)
* Specifically handles option chains for the visual charts in **Live Mode**.
* Features a standard in-memory Cache (`Map<string, {data, timestamp}>`) with a `CACHE_DURATION` of **5 minutes**.
* Fetches from Next.js serverless routes (`/api/options/[ticker]` or `/api/options/india/[ticker]`).
* Resolves and formats payloads using calculations helper functions before returning data to components.

### 2. Backend API Client (`lib/backend-api.ts`)
* Interacts directly with the Express.js backend at `process.env.NEXT_PUBLIC_BACKEND_URL` (defaults to `http://localhost:3001`).
* Routes data for:
  * **Time Machine**: `getCurrentData`, `getHistoricalData`, `getTimestamps`, `getExpiries`.
  * **Trading Journal**: `getJournalTrades`, `createJournalTrade`, `updateJournalTrade`, `deleteJournalTrade`, settings.
  * **Options Flow**: `getOptionsFlowData`.
  * **AI Analyst Agent**: `getAIBriefing`, `sendAIChatMessage`.

---

## 🎨 Styling System & Design Tokens

Styling configuration is specified under **[lib/design-tokens.ts](../lib/design-tokens.ts)**:
* **GEX Heat Colors**: Tailored Hex definitions representing positive GEX (Bullish green `#10B981`) and negative GEX (Bearish red `#EF4444`).
* **Dark Mode Accents**: Dark slate, terminal grays, and glowing borders providing high-contrast visualizations typical of Bloomberg terminals.

---

## 🗺️ Component Hierarchy & Architecture Map

Below is the nested component organization of the dashboard:

```
[app/page.tsx](../app/page.tsx) (Root)
 └── [GammaExposureDashboard](../components/gamma-exposure-dashboard.tsx) (Main orchestrator & state keeper)
      ├── [TerminalHeader](../components/layout/terminal-header.tsx) (Tab selections, active tickers, session status)
      ├── [StatBar](../components/layout/stat-bar.tsx) (Metrics summary cards: Total GEX, Spot Price, Call Wall, Put Wall)
      │
      ├── Workspaces (Mounted conditionally based on selected tab)
      │    │
      │    ├── Tab: "Dashboard"
      │    │    └── [SyncedStrikeWorkspace](../components/charts/synced-strike-workspace.tsx) (Renders multiple charts sharing strike hover states)
      │    │         ├── [GexByStrikeChart](../components/charts/gex-by-strike-chart.tsx) (Bar chart of Calls vs Puts exposure)
      │    │         ├── [CallPutWallsChart](../components/charts/call-put-walls-chart.tsx) (Aggregates wall strikes)
      │    │         ├── [GammaRampChart](../components/charts/gamma-ramp-chart.tsx) (Cumulative GEX slope)
      │    │         ├── [ExpectedMoveChart](../components/charts/expected-move-chart.tsx) (Option IV-implied standard deviation range)
      │    │         └── [ExpirySelector](../components/controls/expiry-selector.tsx) ( Radix popover toolbar component with container portal refs)
      │    │
      │    ├── Tab: "Confluence Hub"
      │    │    └── [ConfluenceHub](../components/confluence/confluence-hub.tsx) (Multi-parameter analysis console)
      │    │         ├── 0DTE Settlebomb Squeeze / Breakout suggestions
      │    │         ├── Wall Touch Probability Indicators ($2 \times |\text{Delta}| \times 100$)
      │    │         ├── [GEXSurfaceChart](../components/charts/gex-surface-chart.tsx) (3D GEX surface by DTE/Strike)
      │    │         └── [IvSurfaceChart](../components/charts/iv-surface-chart.tsx) (3D IV Surface plot via Plotly)
      │    │
      │    ├── Tab: "Option Flow"
      │    │    └── [OptionFlowDashboard](../components/option-flow-dashboard.tsx) (Intraday flow records + sentiment index)
      │    │         ├── [FlowHistoricalView](../components/flow-historical-view.tsx) (Time series analysis of sentiment)
      │    │         └── [AIAnalystPanel](../components/AIAnalystPanel.tsx) (Ticker briefing cards)
      │    │
      │    ├── Tab: "Backtester"
      │    │    └── [BacktestDashboard](../components/algorithms/backtest-dashboard.tsx) (DuckDB configuration and simulator results)
      │    │         ├── [BacktestConfigForm](../components/algorithms/backtest-config-form.tsx) (Entry triggers, strategy selectors)
      │    │         ├── [BacktestCharts](../components/algorithms/backtest-charts.tsx) (Equity curve, drawdown visualizers)
      │    │         ├── [BacktestMetricsGrid](../components/algorithms/backtest-metrics-grid.tsx) (Sharpe, Drawdown, Profit Factor table)
      │    │         └── [StrategyTerminalDrawer](../components/algorithms/strategy-terminal-drawer.tsx) (Condition builders)
      │    │
      │    ├── Tab: "Trading Journal"
      │    │    └── [TradingJournal](../components/trading-journal/trading-journal.tsx) (Journal spreadsheet log and metrics)
      │    │         ├── [CalendarView](../components/trading-journal/calendar-view.tsx) (Monthly grid of trade outcomes)
      │    │         ├── [Heatmap](../components/trading-journal/heatmap.tsx) (PnL distribution chart)
      │    │         ├── [TradeForm](../components/trading-journal/trade-form.tsx) (Trade editor modal)
      │    │         └── [TradeDetail](../components/trading-journal/trade-detail.tsx) (Deep dive and screenshot visualizer)
      │    │
      │    ├── Tab: "Performance Stats" (Active tab: stats)
      │    │    └── [StrategyStatsDashboard](../components/dashboard/strategy-stats-dashboard.tsx) (Comparative trading stats workspace)
      │    │         ├── Plotly double-series equity curve comparing journal returns vs. backtester runs
      │    │         ├── Win rate, profit factor, total trade metrics variance matrices
      │    │         └── 0DTE Settlebomb Suggestions History Tracker (expandable historical prints with option Greeks)
      │    │
      │    ├── Tab: "IV Surface"
      │    │    └── [IvSurfaceChart](../components/charts/iv-surface-chart.tsx) (3D Volatility Skew plot via Plotly)
      │    │
      │    └── Tab: "Quant Pricing" (Active tab: quant)
      │         ├── [ProbabilityMapChart](../components/charts/probability-map-chart.tsx) (Implied terminal PDF solver)
      │         ├── [GarchForecastChart](../components/charts/garch-forecast-chart.tsx) (MLE forecast conditional volatility)
      │         ├── [QuantumTunnelingGauge](../components/charts/quantum-tunneling-gauge.tsx) (Quantum tunneling wall transmission gauge)
      │         └── [CotFlowChart](../components/charts/cot-flow-chart.tsx) (Weekly macro COT positioning tracker)
      │
      ├── [EnhancedTimeMachine](../components/enhanced-time-machine.tsx) (Mounted at screen footer; controls timeline play, speed, and dates)
      └── [AIChatPanel](../components/AIChatPanel.tsx) (Sidebar slide-out terminal for conversations with the AI agent)
```

---

## 🎨 UI & UX Layout Refinements

To optimize vertical and horizontal viewport spacing, several layout enhancements have been implemented:

### 1. Watchlist Ticker Dropdown
* The Watchlist card has been removed from the sidebar. Instead, hovering over the top-left active ticker symbol inside the `<TerminalHeader>` triggers an absolute hover dropdown listing all watchlist tickers with their active price. Selecting a ticker updates the global active symbol state.

### 2. Full-Width Charts Workspace
* With the removal of the sidebar, the GEX distribution sub-tab layout wrapper is adjusted to a single vertical column (`flex flex-col w-full`). The **Synced Strike Workspace** and **Option Chain Grid** now occupy the full horizontal width of the screen.

### 3. Redesigned Horizontal Expiry Selector
* **Row Restructuring**: Expiry selector cards inside `horizontal-expiry-selector.tsx` present information in two rows:
  * **Row 1**: Displays DTE (left-aligned) and the formatted Date (right-aligned).
  * **Row 2**: Displays Call and Put GEX values at the extremes.
* **Compact Card Dimensions**: Height is set to `h-[44px]` with `min-w-[110px]` card width and `py-1.5` padding. The outer scrollable wrapper uses `h-[54px]`, giving ample vertical clearance.
* **Wheel Scroll Redirect**: A custom `useEffect` wheel event listener on the wrapper redirects vertical mouse wheel scrolls to horizontal scrolls, making navigation easy.

### 4. Compact Chart Viewports
* **GARCH Chart**: Restricted to `h-[450px]` inside `garch-forecast-chart.tsx` to keep it clean and prevent it from stretching to fill the remaining screen height.
* **COT Flow Tooltip**: Weekly change bars are moved from a static container into a dynamic D3 hover tooltip overlay that shows the report date and weekly change bar graphs next to the mouse cursor.
* **ResizeObserver Mount Fix**: Added ResizeObserver triggers on conditional states in both GARCH and 3D PDF maps to ensure they stretch cleanly to container dimensions when mounted.

### 5. Candlestick Timeline Axis Drag-Scaling
* **Solid Background Cover**: Underneath the horizontal axis, a solid black background `<rect>` with height of `margin.bottom` (40px) blocks out gridlines and bleeding candle wicks.
* **EW-Resize Scaling**: Added mouse interaction detection (`clickY >= rect.height - 40`) inside the candlestick SVG wrapper. Clicking and dragging horizontally stretches or compresses the visible timeline index range (`xRange`) centered around the midpoint of the visible span.

### 6. Fullscreen Popover Portals
* The Expiry Selector popover inside `<SyncedStrikeWorkspace>` is compatible with browser native HTML5 fullscreen mode. The `<PopoverContent>` accepts a custom `container` prop and passes it to the Radix Portal. Setting `container={containerRef.current}` forces the popover markup to mount within the fullscreen container DOM element, keeping the dropdown visible and clickable in fullscreen mode.
* GEX Magnet, Squeeze, and Breakout target calculations are restricted to a localized window of **±1.5% of the spot price** to ensure order flow attractors target nearest relevant clusters first.
* Touch probabilities for GEX Walls are calculated as $2 \times |\text{Delta}| \times 100$ using the delta of the furthest selected expiration series, and displayed below the badges in the Confluence matrix.

