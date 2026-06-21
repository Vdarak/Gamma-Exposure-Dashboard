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
      │    │         └── [ExpectedMoveChart](../components/charts/expected-move-chart.tsx) (Option IV-implied standard deviation range)
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
      │    └── Tab: "IV Surface"
      │         └── [IvSurfaceChart](../components/charts/iv-surface-chart.tsx) (3D Volatility Skew plot via Plotly)
      │
      ├── [EnhancedTimeMachine](../components/enhanced-time-machine.tsx) (Mounted at screen footer; controls timeline play, speed, and dates)
      └── [AIChatPanel](../components/AIChatPanel.tsx) (Sidebar slide-out terminal for conversations with the AI agent)
```
