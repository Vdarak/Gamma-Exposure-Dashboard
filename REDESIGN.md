# Gamma Exposure Dashboard - Complete Codebase Redesign & Architecture

## Executive Summary

This document provides a complete analysis of the current Gamma Exposure Dashboard codebase architecture, file-by-file breakdown, and structural organization for both frontend and backend. This serves as a blueprint for the complete redesign of the application.

---

## Part 1: Current System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              APPLICATION LAYERS                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    PRESENTATION LAYER (Next.js Frontend)                 │   │
│  │                                                                          │   │
│  │  ├─ Pages: app/page.tsx, app/layout.tsx                                │   │
│  │  ├─ Components: charts, visualizers, time-machine                       │   │
│  │  ├─ UI Library: Radix UI + Tailwind CSS                                │   │
│  │  └─ State Management: React hooks (useState, useCallback, useMemo)     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                       │                                          │
│                                       ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                        API LAYER (Frontend & Backend)                    │   │
│  │                                                                          │   │
│  │  Frontend API Routes:                    Backend API Endpoints:         │   │
│  │  ├─ /api/options/[ticker]               ├─ GET /current-data            │   │
│  │  └─ /api/options/india/[ticker]         ├─ GET /historical-data         │   │
│  │                                           ├─ GET /timestamps              │   │
│  │                                           ├─ GET /stats                   │   │
│  │                                           └─ POST /collect-now            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                       │                                          │
│                                       ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    BUSINESS LOGIC LAYER (Services & Utils)              │   │
│  │                                                                          │   │
│  │  Frontend Libraries:                   Backend Services:                │   │
│  │  ├─ data-service.ts                    ├─ dataCollector.ts              │   │
│  │  ├─ calculations.ts                    ├─ dataRetrieval.ts              │   │
│  │  ├─ backend-api.ts                     └─ types/index.ts                │   │
│  │  └─ utils.ts                                                             │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                       │                                          │
│                                       ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                      DATA PERSISTENCE LAYER                              │   │
│  │                                                                          │   │
│  │                      PostgreSQL Database                                 │   │
│  │                                                                          │   │
│  │  ├─ option_snapshots (metadata table)                                  │   │
│  │  ├─ option_data (option chain data table)                              │   │
│  │  └─ Database functions (cleanup, maintenance)                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

**Frontend:**
- Framework: Next.js 15.2.4 (React 19)
- Styling: Tailwind CSS + PostCSS
- UI Components: Radix UI
- Charting: Plotly.js, Chart.js, Recharts
- Forms: React Hook Form + Zod
- Theme: next-themes
- Icons: Lucide React
- Notifications: Sonner

**Backend:**
- Runtime: Node.js 18.x
- Framework: Express.js
- Scheduling: node-cron
- Database Driver: PostgreSQL (pg)
- HTTP Client: Axios
- Utilities: dotenv, CORS

**Database:**
- PostgreSQL with Railway hosting
- Connection pooling
- Automated cleanup with cron jobs

---

## Part 2: Directory Structure & File Organization

```
gamma-exposure-dashboard/
├── 📁 app/                                    # Next.js App Router
│   ├── 📄 layout.tsx                         # Root layout with theme provider
│   ├── 📄 page.tsx                           # Home page (renders dashboard)
│   ├── 📄 globals.css                        # Global styles & Tailwind imports
│   │
│   └── 📁 api/                               # API Routes
│       └── 📁 options/                       # Options data endpoints
│           ├── 📁 [ticker]/
│           │   └── 📄 route.ts               # Fetch US market option data from CBOE
│           │
│           └── 📁 india/                     # India market endpoints
│               └── 📁 [ticker]/
│                   └── 📄 route.ts           # Fetch India market data from NSE
│
├── 📁 components/                            # React UI Components
│   ├── 📄 gamma-exposure-dashboard.tsx       # MAIN: Central dashboard component
│   ├── 📄 gamma-exposure-visualizer.tsx      # Alternative visualizer
│   ├── 📄 enhanced-time-machine.tsx          # Time travel/historical data player
│   ├── 📄 dashboard-shell.tsx                # Layout wrapper component
│   ├── 📄 dashboard-header.tsx               # Header component
│   ├── 📄 pricing-method-toggle.tsx          # Black-Scholes vs Binomial toggle
│   ├── 📄 total-gex.tsx                      # Total GEX display card
│   ├── 📄 theme-provider.tsx                 # Dark/Light theme wrapper
│   ├── 📄 theme-toggle.tsx                   # Theme switcher button
│   │
│   ├── 📁 charts/                            # Data visualization components
│   │   ├── 📄 gex-by-strike-chart.tsx       # Gamma exposure by strike price
│   │   ├── 📄 gex-by-expiration-chart.tsx   # Gamma exposure by expiration date
│   │   ├── 📄 gex-by-expiration.tsx         # Wrapper for expiration chart
│   │   ├── 📄 gex-surface-chart.tsx         # 3D surface plot (strike × expiry × GEX)
│   │   ├── 📄 gex-surface.tsx               # Wrapper for surface chart
│   │   ├── 📄 call-put-walls-chart.tsx      # Call/Put wall visualization
│   │   ├── 📄 expected-move-chart.tsx       # Expected move bounds
│   │   ├── 📄 gamma-ramp-chart.tsx          # Gamma distribution ramp
│   │   ├── 📄 option-chain.tsx              # Full option chain table
│   │   ├── 📄 total-gex-card.tsx            # Summary GEX statistics
│   │   └── 📄 gex-data-graph-dashboard.tsx  # Graph data visualization
│   │
│   └── 📁 ui/                               # Radix UI component library
│       ├── 📄 accordion.tsx
│       ├── 📄 alert.tsx
│       ├── 📄 alert-dialog.tsx
│       ├── 📄 avatar.tsx
│       ├── 📄 badge.tsx
│       ├── 📄 button.tsx
│       ├── 📄 card.tsx
│       ├── 📄 checkbox.tsx
│       ├── 📄 collapsible.tsx
│       ├── 📄 command.tsx
│       ├── 📄 context-menu.tsx
│       ├── 📄 dialog.tsx
│       ├── 📄 drawer.tsx
│       ├── 📄 dropdown-menu.tsx
│       ├── 📄 form.tsx
│       ├── 📄 hover-card.tsx
│       ├── 📄 input.tsx
│       ├── 📄 input-otp.tsx
│       ├── 📄 label.tsx
│       ├── 📄 menubar.tsx
│       ├── 📄 navigation-menu.tsx
│       ├── 📄 pagination.tsx
│       ├── 📄 popover.tsx
│       ├── 📄 progress.tsx
│       ├── 📄 radio-group.tsx
│       ├── 📄 scroll-area.tsx
│       ├── 📄 select.tsx
│       ├── 📄 separator.tsx
│       ├── 📄 sheet.tsx
│       ├── 📄 sidebar.tsx
│       ├── 📄 skeleton.tsx
│       ├── 📄 slider.tsx
│       ├── 📄 sonner.tsx
│       ├── 📄 switch.tsx
│       ├── 📄 table.tsx
│       ├── 📄 tabs.tsx
│       ├── 📄 textarea.tsx
│       ├── 📄 toggle.tsx
│       ├── 📄 toggle-group.tsx
│       ├── 📄 tooltip.tsx
│       ├── 📄 use-mobile.tsx
│       ├── 📄 use-toast.ts
│       ├── 📄 resizable.tsx
│       ├── 📄 chart.tsx
│       ├── 📄 toast.tsx
│       ├── 📄 toaster.tsx
│       └── 📄 carousel.tsx
│
├── 📁 hooks/                                 # Custom React hooks
│   ├── 📄 use-mobile.tsx                     # Detect mobile/responsive layout
│   └── 📄 use-toast.ts                       # Toast notification hook
│
├── 📁 lib/                                   # Utility & service layer
│   ├── 📄 types.ts                           # TypeScript interfaces & types
│   ├── 📄 data-service.ts                    # Frontend API client service
│   ├── 📄 calculations.ts                    # GEX & Greeks calculations
│   ├── 📄 backend-api.ts                     # Backend API communication
│   ├── 📄 utils.ts                           # Utility functions (cn, etc.)
│   └── 📄 react-plotly.js.d.ts              # Type definitions for Plotly
│
├── 📁 public/                                # Static assets
│
├── 📁 types/                                 # Global type definitions
│   └── 📄 react-plotly.js.d.ts              # Plotly type augmentation
│
├── 📁 backend/                               # Backend Express server
│   ├── 📄 package.json                       # Backend dependencies
│   ├── 📄 tsconfig.json                      # TypeScript config
│   ├── 📄 railway.json                       # Railway deployment config
│   ├── 📄 README.md                          # Backend documentation
│   │
│   └── 📁 src/
│       ├── 📄 server.ts                      # Express app & cron jobs
│       │
│       ├── 📁 db/
│       │   ├── 📄 connection.ts              # PostgreSQL connection pool
│       │   ├── 📄 init.ts                    # Database initialization
│       │   └── 📄 schema.sql                 # Database schema & tables
│       │
│       ├── 📁 services/
│       │   ├── 📄 dataCollector.ts           # CBOE/NSE API fetching & storage
│       │   └── 📄 dataRetrieval.ts           # Query historical data
│       │
│       └── 📁 types/
│           └── 📄 index.ts                   # Backend type definitions
│
├── 📄 ARCHITECTURE.md                        # Current architecture documentation
├── 📄 ARCHITECTURE_FUNCTIONS.md              # Function reference documentation
├── 📄 package.json                           # Frontend dependencies
├── 📄 pnpm-lock.yaml                         # Dependency lock file
├── 📄 tsconfig.json                          # TypeScript configuration
├── 📄 tailwind.config.ts                     # Tailwind CSS configuration
├── 📄 next.config.mjs                        # Next.js configuration
├── 📄 postcss.config.mjs                     # PostCSS configuration
├── 📄 components.json                        # shadcn/ui configuration
├── 📄 next-env.d.ts                          # Next.js type definitions
└── 📄 .env                                   # Environment variables

```

---

## Part 3: Frontend Components Detailed Breakdown

### 3.1 Page & Layout Layer

#### `app/layout.tsx`
**Purpose:** Root layout component for the entire application
**Responsibilities:**
- Configures Next.js metadata (title, description)
- Wraps entire app with ThemeProvider for dark/light mode support
- Applies global fonts (Inter from Google Fonts)
- Sets up CSS classes and global styling
- Provides authentication/session context (if added)

**Key Functions:**
- `RootLayout()` - Renders HTML structure with theme support

---

#### `app/page.tsx`
**Purpose:** Home/landing page of the application
**Responsibilities:**
- Simple wrapper that renders the main GammaExposureDashboard component
- Provides container styling and padding

**Key Functions:**
- `HomePage()` - Default export for the root route

---

#### `app/globals.css`
**Purpose:** Global styles and Tailwind CSS imports
**Includes:**
- Tailwind directives (@tailwind base, components, utilities)
- CSS variables for theming
- Global component styles
- Responsive typography

---

### 3.2 Main Dashboard Component

#### `components/gamma-exposure-dashboard.tsx`
**Purpose:** MAIN ORCHESTRATOR - The central hub that coordinates all dashboard functionality
**Size:** ~1,010 lines (largest component)

**Responsibilities:**
- Manages global state (ticker selection, time period, pricing method)
- Fetches option data from the backend
- Handles time-machine functionality for historical data
- Renders all visualization charts
- Manages loading/error states
- Provides pricing method toggle (Black-Scholes vs Binomial)

**Key State Variables:**
- `selectedTicker` - Currently selected stock ticker
- `market` - US or INDIA market selection
- `optionData` - Current option chain data
- `spotPrice` - Current underlying asset price
- `selectedExpiry` - Currently selected expiration date
- `pricingMethod` - Calculation method selection
- `timeSeriesData` - Historical data for time-machine
- `currentTimestamp` - Current time in time-machine

**Key Functions:**
- `GammaExposureDashboard()` - Main component
- `Gauge()` - Custom gauge visualization for metrics
- `calculateGEXIntensity()` - Computes total GEX from option data
- `calculateGEXWeightedVolatility()` - Weighted IV calculation

**Sub-Components Rendered:**
- EnhancedTimeMachine
- TotalGEXCard
- GEXByStrikeChart
- GEXByExpirationChart
- GEXSurfaceChart
- CallPutWallsChart
- ExpectedMoveChart
- GammaRampChart
- OptionChain (data table)

---

#### `components/gamma-exposure-visualizer.tsx`
**Purpose:** Alternative visualization layout
**Responsibilities:**
- Different arrangement of the same charts
- May be used for alternative view modes

---

### 3.3 UI Component Library (`components/ui/`)

**Purpose:** Reusable UI building blocks from Radix UI + shadcn/ui
**Count:** ~40+ component files

**Key Components:**
- **Form Elements:** `button.tsx`, `input.tsx`, `select.tsx`, `checkbox.tsx`, `radio-group.tsx`, `toggle.tsx`, `switch.tsx`
- **Layout:** `card.tsx`, `tabs.tsx`, `accordion.tsx`, `drawer.tsx`, `sheet.tsx`, `sidebar.tsx`
- **Content:** `badge.tsx`, `label.tsx`, `separator.tsx`, `progress.tsx`, `alert.tsx`
- **Popups:** `dialog.tsx`, `popover.tsx`, `tooltip.tsx`, `context-menu.tsx`, `dropdown-menu.tsx`
- **Advanced:** `carousel.tsx`, `resizable.tsx`, `scroll-area.tsx`, `command.tsx`, `navigation-menu.tsx`
- **Utilities:** `form.tsx` (React Hook Form integration), `use-toast.ts`, `use-mobile.tsx`

**Note:** These are pre-built components from shadcn/ui, styled with Tailwind CSS

---

### 3.4 Feature Components

#### `components/enhanced-time-machine.tsx`
**Purpose:** Time-travel functionality for historical data analysis
**Size:** ~540 lines

**Responsibilities:**
- Provides slider for selecting historical timestamps
- Play/Pause controls for time animation
- Displays data at selected timestamp
- Renders GEXByStrikeChart for time-specific data
- Fetches available timestamps from backend

**Key State:**
- `timestamps` - List of available data collection times
- `selectedIndex` - Currently selected timestamp
- `isPlaying` - Animation state

**Key Functions:**
- `EnhancedTimeMachine()` - Main component
- Slider change handlers
- Play/Pause logic
- Data fetching on timestamp selection

---

#### `components/pricing-method-toggle.tsx`
**Purpose:** Toggle between Black-Scholes and Binomial pricing models
**Responsibilities:**
- Simple toggle UI
- Callback to parent component on method change
- Displays current calculation method

---

#### `components/total-gex.tsx`
**Purpose:** Display total gamma exposure for selected ticker
**Responsibilities:**
- Fetches latest GEX data
- Formats and displays total GEX value
- Shows market sentiment indicator

---

#### `components/dashboard-header.tsx`
**Purpose:** Header section with branding and metadata
**Responsibilities:**
- Display dashboard title
- Show subtitle/description
- Provide action buttons space

---

#### `components/dashboard-shell.tsx`
**Purpose:** Wrapper layout component
**Responsibilities:**
- Simple grid layout for dashboard sections
- Applies consistent spacing and styling

---

#### `components/theme-provider.tsx` & `components/theme-toggle.tsx`
**Purpose:** Dark/Light mode support
**Responsibilities:**
- `theme-provider.tsx` - Wraps app with next-themes
- `theme-toggle.tsx` - Button to switch between themes

---

### 3.5 Chart Components (`components/charts/`)

#### `components/charts/gex-by-strike-chart.tsx`
**Purpose:** Visualize gamma exposure at different strike prices
**Displays:**
- X-axis: Strike price levels
- Y-axis: Gamma exposure (GEX) value
- Color: Different colors for call/put GEX
- Overlay: Current spot price indicator

**Used By:** Time-machine, main dashboard
**Libraries:** Plotly.js or Recharts

---

#### `components/charts/gex-by-expiration-chart.tsx`
**Purpose:** Show cumulative GEX across expiration dates
**Displays:**
- X-axis: Expiration dates
- Y-axis: Total GEX per expiration
- Stacked bars or line chart

---

#### `components/charts/gex-by-expiration.tsx`
**Purpose:** Wrapper for expiration chart with data preparation

---

#### `components/charts/gex-surface-chart.tsx`
**Purpose:** 3D surface plot visualization
**Displays:**
- X-axis: Strike price
- Y-axis: Days to expiration
- Z-axis: Gamma exposure magnitude
- Creates 3D surface mesh

**Libraries:** Plotly.js (3D support)

---

#### `components/charts/gex-surface.tsx`
**Purpose:** Wrapper for surface chart

---

#### `components/charts/call-put-walls-chart.tsx`
**Purpose:** Identify and highlight option walls (abnormal OI concentration)
**Displays:**
- Call walls (large call concentration)
- Put walls (large put concentration)
- Level of concentration intensity

**Indicator Significance:**
- Walls can indicate dealer hedging or support/resistance levels

---

#### `components/charts/expected-move-chart.tsx`
**Purpose:** Show implied market move boundaries
**Displays:**
- Upper move boundary (spot × (1 + IV))
- Lower move boundary (spot × (1 - IV))
- Current spot price
- Probability zones

**Calculation:** Uses implied volatility to estimate expected move range

---

#### `components/charts/gamma-ramp-chart.tsx`
**Purpose:** Show gamma distribution across strikes
**Displays:**
- Gamma value for each strike
- Cumulative gamma profile
- Indicates sensitive zones

---

#### `components/charts/option-chain.tsx`
**Purpose:** Tabular view of complete option chain
**Size:** ~100+ lines

**Displays:**
- Strike price
- Call data: IV, Delta, Gamma, OI, Volume, Price
- Put data: Same columns
- Ability to sort/filter

---

#### `components/charts/total-gex-card.tsx`
**Purpose:** Summary card showing total GEX and key metrics
**Displays:**
- Total GEX value
- Market sentiment (positive/negative)
- Last updated timestamp
- Refresh button

---

#### `components/charts/gex-data-graph-dashboard.tsx`
**Purpose:** Alternative graph visualization layout

---

### 3.6 Hooks (`hooks/`)

#### `hooks/use-mobile.tsx`
**Purpose:** Detect if application is running on mobile device
**Returns:** Boolean indicating mobile viewport

---

#### `hooks/use-toast.ts`
**Purpose:** Toast notification management
**Provides:** Functions to show success/error/info notifications

---

---

## Part 4: Frontend Library & Service Layer

### 4.1 Types & Interfaces (`lib/types.ts`)

**Key Interfaces:**

```typescript
OptionData {
  option: string
  type: "C" | "P"
  strike: number
  expiration: Date
  gamma: number
  open_interest: number
  volume?: number
  iv: number
  delta: number
  bid?: number
  ask?: number
  last?: number
  GEX?: number
  GEX_BS?: number
  daysTillExp?: number
}

CBOEResponse {
  data: {
    current_price: number
    options: OptionData[]
  }
}

GEXByStrike {
  strike: number
  gex: number
}

GEXByExpiration {
  expiration: string
  gex: number
}

CallPutWalls {
  callOI: { strike: number; oi: number }[]
  putOI: { strike: number; oi: number }[]
  callWall?: number
  putWall?: number
}

ExpectedMove {
  date: Date
  upper: number
  lower: number
  upperPct: number
  lowerPct: number
}
```

---

### 4.2 Data Service (`lib/data-service.ts`)

**Purpose:** Frontend API client for fetching option data
**Size:** ~131 lines

**Key Functionality:**
- Caches responses (5-minute TTL)
- Differentiates between US and INDIA markets
- Calls appropriate API route based on market
- Error handling with descriptive messages
- Supports Black-Scholes and Binomial pricing methods

**Key Methods:**
- `fetchOptionData(ticker, market, pricingMethod)` - Main data fetch method
- `cache` - Map storing cached responses with timestamps

**Error Handling:**
- Validates response structure
- Checks for valid price data
- Handles empty option chains
- Provides market-specific error messages

---

### 4.3 Calculations Library (`lib/calculations.ts`)

**Purpose:** Financial calculation engine for option Greeks and gamma exposure
**Size:** ~832 lines (LARGEST library file)

**Key Pricing Methods:**
- Black-Scholes (default)
- Binomial model (alternative)

**Key Functions:**

#### `calcGammaEx(S, K, vol, T, r, q, optType, OI)`
**Purpose:** Calculate gamma exposure for single option
**Inputs:**
- S: Spot price
- K: Strike price
- vol: Implied volatility
- T: Time to expiration (years)
- r: Risk-free rate
- q: Dividend yield
- optType: "call" or "put"
- OI: Open interest

**Outputs:** GEX value (notional gamma exposure)

**Formula:** Uses Black-Scholes gamma × OI × Spot² × 0.01

---

#### Other Key Functions:
- `computeTotalGEX(optionData, spotPrice, pricingMethod)` - Sum all GEX
- `calcDelta()` - Directional sensitivity
- `calcVega()` - Volatility sensitivity
- `calcTheta()` - Time decay
- `calcRho()` - Interest rate sensitivity
- `blackScholesPrice()` - Option price calculation
- `binomialPrice()` - Alternative pricing
- `calculateGEXByStrike()` - Aggregate GEX by strike level
- `calculateGEXByExpiration()` - Aggregate GEX by expiration
- `calculateCallPutWalls()` - Identify concentration zones
- `calculateExpectedMove()` - IV-based move estimation
- `fixOptionData()` - Data normalization and validation

**Mathematical Basis:**
- Standard Black-Scholes partial differential equation
- Gamma: ∂²Price/∂S² (convexity of option price)
- GEX = Gamma × OI × Spot² × 0.01 (notional exposure)

---

### 4.4 Backend API Service (`lib/backend-api.ts`)

**Purpose:** Communication layer with Railway backend
**Size:** ~242 lines

**Configuration:**
- Base URL from environment variable or localhost:3001

**Key Interfaces:**

```typescript
OptionData {
  strike, type, expiration, bid, ask, last, volume,
  openInterest, impliedVolatility, delta, gamma, theta, vega, rho
}

SnapshotData {
  snapshotId, ticker, timestamp, spotPrice, dataCount, options
}

TimestampInfo {
  timestamp, spotPrice
}

ExpiryInfo {
  expiration, optionCount
}

StatsData {
  ticker, snapshotCount, oldestSnapshot, newestSnapshot, averageOptionsPerSnapshot
}
```

**Key Functions:**
- `healthCheck()` - Verify backend connectivity
- `getCurrentData(ticker, market)` - Latest option data
- `getHistoricalData(ticker, hoursBack)` - Time-range queries
- `getDataAtTimestamp(ticker, timestamp)` - Specific point-in-time
- `getAvailableTimestamps(ticker)` - List of collection times
- `getAvailableExpiries(ticker)` - List of expirations
- `getStats(ticker)` - Metadata statistics
- `collectNow(ticker, market)` - Trigger immediate collection

---

### 4.5 Utilities (`lib/utils.ts`)

**Purpose:** General utility functions
**Content:**
- `cn()` - Class name merge function (clsx + tailwind-merge)
  - Merges Tailwind classes without conflicts
  - Used throughout all components

---

---

## Part 5: Frontend API Routes

### 5.1 US Market Options Route

#### `app/api/options/[ticker]/route.ts`

**Purpose:** Proxy for CBOE API
**Method:** GET
**Parameters:** 
- `ticker` (URL param): Stock ticker symbol

**Workflow:**
1. Converts ticker to uppercase
2. Attempts to fetch from CBOE CDN with underscore prefix (_SPX)
3. Falls back to non-underscore format (SPX)
4. Extracts current_price and options array
5. Returns JSON response

**Error Handling:**
- Returns 404 if ticker not found on CBOE
- Returns descriptive error message
- Logs raw response structure for debugging

**Response Format:**
```json
{
  "current_price": 5850.25,
  "options": [
    {
      "strike": 5800,
      "type": "C",
      "expiration": "2025-10-20",
      "iv": 0.15,
      "gamma": 0.002,
      ...
    }
  ]
}
```

---

### 5.2 India Market Options Route

#### `app/api/options/india/[ticker]/route.ts`

**Purpose:** Proxy for NSE/BSE India options data
**Method:** GET
**Parameters:**
- `ticker` (URL param): India market ticker (NIFTY, BANKNIFTY, etc.)

**Workflow:**
- Fetches from India options exchange API
- Transforms NSE data format to application format
- Handles India market-specific date formats
- Returns normalized option chain

---

---

## Part 6: Backend Architecture

### 6.1 Server Initialization (`backend/src/server.ts`)

**Purpose:** Express application setup, middleware, cron jobs, and route definitions
**Size:** ~426 lines

**Key Responsibilities:**

1. **Express Setup**
   - Creates Express app instance
   - Configures middleware (CORS, JSON parsing)
   - Sets PORT from environment (default: 3001)

2. **CORS Configuration**
   - Allows multiple origins (localhost:3000, Vercel deployments)
   - Supports Vercel preview deployments with regex matching
   - Can be configured per environment

3. **Market Configuration**
   - US Market Hours: 14:30-21:00 UTC (9:30 AM - 4:00 PM EST)
   - India Market Hours: 03:45-10:00 UTC (9:15 AM - 3:30 PM IST)
   - Configurable via environment variables
   - Separate ticker lists for each market

4. **Cron Job Scheduling**
   - **Data Collection:** Every 15 minutes (market hours only)
   - **Cleanup:** Daily at 2 AM UTC
   - Only collects during active market hours
   - Can be triggered manually via `/collect-now` endpoint

5. **API Routes**

   **GET /api/current-data?ticker=SPX**
   - Returns latest snapshot for ticker
   - Response: OptionSnapshot with current data

   **GET /api/historical-data?ticker=SPX&hoursBack=24**
   - Returns all snapshots within time window
   - Alternative: Use startDate/endDate for range queries

   **GET /api/data-at-timestamp?ticker=SPX&timestamp=2025-10-20T14:30:00Z**
   - Returns closest snapshot to specific time
   - Used by time-machine component

   **GET /api/timestamps?ticker=SPX**
   - Lists all available data collection times
   - Allows frontend to populate time-machine slider

   **GET /api/available-expiries?ticker=SPX**
   - Lists unique expiration dates for ticker

   **GET /api/stats?ticker=SPX**
   - Returns metadata: snapshot count, date range, avg options/snapshot

   **POST /api/collect-now**
   - Body: { "ticker": "SPX", "market": "USA" }
   - Triggers immediate data collection
   - Returns collected data

6. **Database Initialization**
   - Calls `initializeDatabase()` on startup
   - Creates tables if they don't exist
   - Sets up indexes and functions

7. **Environment Variables**
   ```
   PORT=3001
   DATABASE_URL=postgresql://user:pass@host/db
   FRONTEND_URL=http://localhost:3000
   COLLECT_INTERVAL_MINUTES=15
   DATA_RETENTION_DAYS=3
   NODE_ENV=development
   US_TICKERS=SPX,GLD,TSLA
   INDIA_TICKERS=NIFTY,BANKNIFTY,RELIANCE
   ```

---

### 6.2 Data Collection Service (`backend/src/services/dataCollector.ts`)

**Purpose:** Fetch option data from CBOE/NSE APIs and store in database
**Size:** ~644 lines

**Key Components:**

1. **CBOE Data Fetching**
   - Makes HTTP requests to CBOE CDN API
   - Parses option chain data
   - Extracts Greeks (delta, gamma, vega, theta, rho)
   - Handles rate limiting and retries

2. **NSE Data Fetching** (India)
   - Fetches from NSE API
   - Transforms NSE field names to standard format
   - Calculates Greeks if not provided

3. **Data Normalization**
   - Converts all date formats to ISO 8601
   - Normalizes strike prices to decimals
   - Validates required fields

4. **Database Storage**
   - Creates OptionSnapshot record (metadata)
   - Creates OptionData records (individual options)
   - Handles bulk inserts efficiently

5. **Key Functions**
   - `fetchAndStoreMultipleTickers(tickers, market)` - Main orchestrator
   - `fetchCBOEData(ticker)` - CBOE-specific fetch
   - `fetchNSEData(ticker)` - NSE-specific fetch
   - `storeSnapshot(ticker, data, market)` - Database insert

**Data Validation:**
- Checks for required fields (strike, type, iv, oi)
- Filters out invalid records
- Logs skipped entries

---

### 6.3 Data Retrieval Service (`backend/src/services/dataRetrieval.ts`)

**Purpose:** Query historical data from database
**Size:** ~308 lines

**Key Functions:**

1. **getHistoricalData(ticker, hoursBack?, startDate?, endDate?)**
   - Fetches all snapshots within time range
   - Aggregates related option data via JSON
   - Returns array of OptionSnapshot objects
   - Most flexible query method

2. **getDataAtTimestamp(ticker, timestamp)**
   - Finds snapshot closest to requested time
   - Returns single OptionSnapshot

3. **getAvailableTimestamps(ticker)**
   - Lists all collection timestamps for ticker
   - Sorted descending (newest first)
   - Used for time-machine slider

4. **getAvailableExpiries(ticker, snapshotId?)**
   - Lists unique expiration dates
   - Can be filtered to specific snapshot

5. **getCurrentData(ticker)**
   - Returns most recent snapshot
   - Equivalent to `getHistoricalData(ticker, hoursBack=1)` limited to 1 result

6. **getDataStatistics(ticker)**
   - Metadata: total snapshots, date range, average option count
   - Used for dashboard info panels

**Query Optimization:**
- Uses indexed columns (ticker, timestamp)
- JSON aggregation for efficient retrieval
- Bulk operations for performance

---

### 6.4 Database Connection (`backend/src/db/connection.ts`)

**Purpose:** PostgreSQL connection pool management
**Size:** Small utility file

**Key Features:**
- Uses pg.Pool for connection pooling
- Configurable max connections (default: 20)
- Configurable timeout values
- SSL support for production
- Error logging

**Configuration:**
- Reads DATABASE_URL from environment
- Applies SSL in production
- Connection pooling for performance

---

### 6.5 Database Initialization (`backend/src/db/init.ts`)

**Purpose:** Schema setup and data maintenance
**Size:** Small utility file

**Key Functions:**

1. **initializeDatabase()**
   - Reads schema.sql file
   - Executes SQL commands to create tables
   - Runs on backend startup
   - Creates indexes and functions

2. **cleanOldData(daysToKeep)**
   - Calls PostgreSQL function to delete old snapshots
   - Cascades to option_data records
   - Runs on schedule (daily)
   - Configurable retention period

---

### 6.6 Database Schema (`backend/src/db/schema.sql`)

**Purpose:** PostgreSQL table definitions and relationships

**Tables:**

#### `option_snapshots`
**Purpose:** Metadata for each data collection event

```sql
CREATE TABLE option_snapshots (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  spot_price DECIMAL(12, 4) NOT NULL,
  data_count INTEGER NOT NULL DEFAULT 0,
  market VARCHAR(10) DEFAULT 'USA',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

Indexes:
- idx_snapshots_ticker_timestamp (ticker, timestamp DESC) -- Most common query
- idx_snapshots_timestamp (timestamp DESC) -- Time-based queries
- idx_snapshots_ticker (ticker) -- Ticker lookups
```

**Columns Explained:**
- `id`: Unique identifier
- `ticker`: Stock symbol (SPX, NIFTY, etc.)
- `timestamp`: When data was collected (market time)
- `spot_price`: Underlying asset price at collection
- `data_count`: Number of option records for this snapshot
- `market`: Market type (USA/INDIA)
- `created_at`: Record creation time (server time)

---

#### `option_data`
**Purpose:** Individual option chain data

```sql
CREATE TABLE option_data (
  id SERIAL PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES option_snapshots(id) ON DELETE CASCADE,
  strike DECIMAL(12, 4) NOT NULL,
  option_type CHAR(1) NOT NULL CHECK (option_type IN ('C', 'P')),
  expiration DATE NOT NULL,
  last_price DECIMAL(12, 4),
  bid DECIMAL(12, 4),
  ask DECIMAL(12, 4),
  volume INTEGER DEFAULT 0,
  open_interest INTEGER DEFAULT 0,
  implied_volatility DECIMAL(8, 6),
  delta DECIMAL(8, 6),
  gamma DECIMAL(10, 8),
  theta DECIMAL(10, 8),
  vega DECIMAL(10, 8),
  rho DECIMAL(10, 8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

Indexes:
- idx_option_data_snapshot (snapshot_id) -- Join optimization
- idx_option_data_strike (strike) -- Strike-based queries
- idx_option_data_expiration (expiration) -- Expiration lookups
- idx_option_data_type (option_type) -- Call/Put separation
```

**Columns Explained:**
- `snapshot_id`: Foreign key to option_snapshots
- `strike`: Strike price level
- `option_type`: 'C' for call, 'P' for put
- `expiration`: Expiration date
- `last_price`: Last traded price
- `bid`/`ask`: Bid-ask spread
- `volume`: Trading volume
- `open_interest`: Outstanding contracts
- `implied_volatility`: IV (annualized percentage)
- `delta`: Delta (directional sensitivity, -1 to 1)
- `gamma`: Gamma (convexity, typically 0-0.01)
- `theta`: Theta (time decay per day)
- `vega`: Vega (volatility sensitivity per 1% IV move)
- `rho`: Rho (interest rate sensitivity)

---

### 6.7 Backend Types (`backend/src/types/index.ts`)

**Purpose:** TypeScript interfaces for backend operations

**Key Interfaces:**

```typescript
OptionData {
  strike: number
  type: 'C' | 'P'
  expiration: Date
  lastPrice: number
  bid?: number
  ask?: number
  volume: number
  openInterest: number
  impliedVolatility: number
  delta?: number
  gamma?: number
  theta?: number
  vega?: number
  rho?: number
}

OptionSnapshot {
  id?: number
  ticker: string
  timestamp: Date
  spotPrice: number
  dataCount: number
  market: 'USA' | 'INDIA'
  options?: OptionData[]
}

APIResponse<T> {
  success: boolean
  data?: T
  error?: string
  timestamp: Date
}
```

---

### 6.8 Backend Configuration

#### `backend/railway.json`
**Purpose:** Railway.app deployment configuration
- Specifies build and start commands
- Environment variable setup
- Postgres service configuration

#### `backend/package.json`
**Purpose:** Node.js dependencies and scripts
```json
{
  "scripts": {
    "start": "node dist/server.js",
    "dev": "ts-node src/server.ts",
    "build": "tsc && mkdir -p dist/db && cp src/db/schema.sql dist/db/",
    "watch": "tsc -w"
  }
}
```

---

---

## Part 7: Data Flow Architecture

### 7.1 Real-Time Data Collection Flow

```
┌──────────────────┐
│   Cron Schedule  │  Every 15 minutes (market hours only)
│   (node-cron)    │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────┐
│  checkMarketHours()      │  Verify US/India market is open
│  Market time validator   │
└────────┬─────────────────┘
         │
         ├──────────────────────────────────────┐
         ▼                                      ▼
   ┌──────────────┐                  ┌──────────────────┐
   │ US Markets   │                  │ India Markets    │
   │ (9:30-16:00) │                  │ (9:15-15:30 IST) │
   └──────┬───────┘                  └────────┬─────────┘
          │                                   │
          ├─► SPX                             ├─► NIFTY
          ├─► GLD                             ├─► BANKNIFTY
          └─► TSLA                            └─► RELIANCE
          │                                   │
          ▼                                   ▼
   ┌──────────────────────┐         ┌──────────────────────┐
   │  fetchCBOEData()     │         │  fetchNSEData()      │
   │  https://cdn.cboe    │         │  https://nse.api    │
   └──────┬───────────────┘         └────────┬─────────────┘
          │                                   │
          ▼                                   ▼
   ┌──────────────────────────────────────────────────┐
   │        storeSnapshot() to Database               │
   │                                                  │
   │  1. INSERT into option_snapshots                │
   │     (ticker, timestamp, spot_price, market)     │
   │                                                  │
   │  2. INSERT INTO option_data (bulk)              │
   │     (snapshot_id, strike, type, iv, oi, etc.)   │
   └──────────────────────────────────────────────────┘
           │
           ▼
   ┌──────────────────────┐
   │  PostgreSQL Database │
   └──────────────────────┘
```

---

### 7.2 Frontend Data Request Flow

```
┌──────────────────────────────┐
│  User Interface              │
│  - Ticker selection          │
│  - Time-machine slider       │
│  - Pricing method toggle     │
└────────────┬─────────────────┘
             │
             ▼
┌──────────────────────────────────┐
│ gamma-exposure-dashboard.tsx     │
│ (Main orchestrator)              │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ DataService.fetchOptionData()    │
│ - Check 5-minute cache           │
│ - Validate market selection      │
└────────┬─────────────────────────┘
         │
         ├──────── Cache Hit? ───────► Return Cached Data
         │
         └──────── Cache Miss ────┐
                                  ▼
                    ┌─────────────────────────────────┐
                    │ Next.js API Route               │
                    │ /api/options/[ticker]           │
                    │ or /api/options/india/[ticker]  │
                    └────────┬────────────────────────┘
                             │
                             ▼
                    ┌─────────────────────────────────┐
                    │ External API                    │
                    │ - CBOE CDN (US markets)         │
                    │ - NSE API (India markets)       │
                    └────────┬────────────────────────┘
                             │
                             ▼
                    ┌─────────────────────────────────┐
                    │ calculations.fixOptionData()    │
                    │ - Normalize data format         │
                    │ - Validate Greeks               │
                    │ - Apply pricing method          │
                    └────────┬────────────────────────┘
                             │
                             ▼
                    ┌─────────────────────────────────┐
                    │ Cache response (5 minutes)      │
                    └────────┬────────────────────────┘
                             │
         ┌───────────────────┴─────────────────────┐
         ▼                                         ▼
    ┌─────────────┐              ┌────────────────────────┐
    │ Frontend    │              │ Calculate metrics:     │
    │ receives    │              │ - Total GEX            │
    │ OptionData  │              │ - GEX by strike        │
    └─────┬───────┘              │ - GEX by expiration    │
          │                       │ - Call/Put walls       │
          ▼                       │ - Expected move        │
    ┌─────────────────────────────────────────────────┐
    │ Render Charts & Visualizations                │
    │ - GammaExposureDashboard                       │
    │ - All sub-components                           │
    └─────────────────────────────────────────────────┘
```

---

### 7.3 Historical Data / Time-Machine Flow

```
┌──────────────────────────────────┐
│ EnhancedTimeMachine Component     │
│ - Show time slider               │
│ - Play/Pause controls            │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Fetch available timestamps       │
│ GET /api/timestamps?ticker=SPX   │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Backend dataRetrieval Service    │
│ - Query option_snapshots         │
│ - Get all timestamps for ticker  │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ User drags time slider           │
│ or clicks Play                   │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ User selects timestamp           │
│ onTimestampChange() triggered    │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ GET /api/data-at-timestamp               │
│ ?ticker=SPX&timestamp=2025-10-20T14:30Z  │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Backend finds closest snapshot   │
│ Returns historical OptionData    │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Frontend renders GEXByStrikeChart│
│ with historical data             │
└──────────────────────────────────┘
```

---

### 7.4 Calculation Flow for Gamma Exposure

```
┌────────────────────────────────────────────┐
│ Raw Option Data from CBOE/NSE              │
│ {strike, type, iv, oi, delta, gamma, ...}  │
└────────┬─────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────┐
│ fixOptionData() - Normalize & Validate         │
│ 1. Check for missing required fields           │
│ 2. Convert date formats                        │
│ 3. Validate numeric ranges                     │
└────────┬─────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────┐
│ computeTotalGEX()                              │
│ Sum GEX across all strikes                     │
└────────┬─────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────┐
│ For each option in chain:                      │
│                                                │
│ 1. Get Greeks (delta, gamma, vega, theta)     │
│    from CBOE/NSE or calculate if missing       │
│                                                │
│ 2. Calculate GEX using pricing method:         │
│    - Black-Scholes (default)                   │
│    - Binomial model                            │
│                                                │
│    GEX = Spot² × Gamma × OI × 0.01            │
│    (in billion dollars per 1% move)            │
│                                                │
│ 3. Sign adjustment:                            │
│    - Calls: positive GEX (dealer long gamma)  │
│    - Puts: negative GEX (dealer short gamma)   │
└────────┬─────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────┐
│ Aggregate calculations:                        │
│                                                │
│ - calculateGEXByStrike()                       │
│   Sum GEX for each strike level                │
│                                                │
│ - calculateGEXByExpiration()                   │
│   Sum GEX for each expiration date             │
│                                                │
│ - calculateCallPutWalls()                      │
│   Identify concentration zones                 │
│                                                │
│ - calculateExpectedMove()                      │
│   Estimate move: ±Spot × IV × √(T)           │
│                                                │
│ - calculateGammaRamp()                         │
│   Gamma profile by strike                      │
└────────┬─────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────┐
│ Render visualizations:                         │
│ - GEX by Strike Chart                          │
│ - GEX by Expiration                            │
│ - 3D GEX Surface                               │
│ - Call/Put Walls                               │
│ - Expected Move Bands                          │
│ - Gamma Ramp Distribution                      │
│ - Option Chain Table                           │
└────────────────────────────────────────────────┘
```

---

---

## Part 8: Key Design Patterns & Decisions

### 8.1 Component Architecture

**Pattern:** Composition over Inheritance
- Small, focused components
- Props-based configuration
- Reusable UI primitives from Radix UI

**Organization:**
- `/ui` - Design system (atomic components)
- `/charts` - Visualization components (composite)
- Root-level feature components (functional areas)

---

### 8.2 State Management

**Pattern:** React Hooks (no Redux/Context)
- `useState` for local component state
- `useCallback` for memoized handlers
- `useMemo` for expensive calculations
- Props drilling for parent-child communication

**Rationale:**
- Simpler mental model for financial calculations
- No middleware complexity
- Direct control over re-renders

---

### 8.3 Data Caching

**Frontend:** 5-minute in-memory cache
- Reduces API calls during exploration
- Cache key includes market and pricing method
- Automatic invalidation after TTL

**Backend:** Database with retention policy
- Stores all historical snapshots
- 3-day retention (configurable)
- Daily cleanup cron job
- Prevents unlimited database growth

---

### 8.4 API Design

**Frontend Routes:** Proxies to external APIs
- CBOE CDN for US markets
- NSE for India markets
- Handles CORS and data transformation

**Backend Routes:** RESTful design
- GET for data retrieval
- POST for immediate collection
- Query parameters for filtering
- Consistent response format with APIResponse wrapper

---

### 8.5 Database Design

**Schema:** Normalized relational
- `option_snapshots`: Metadata (one per collection)
- `option_data`: Detail records (many per snapshot)
- Foreign key cascade delete
- Strategic indexes on common queries

**Performance Considerations:**
- Composite index on (ticker, timestamp) for most queries
- Separate index on timestamp for time-range queries
- JSON aggregation for efficient retrieval
- Bulk inserts for data collection

---

### 8.6 Scheduling & Automation

**Pattern:** Cron-based collection
- Market-aware scheduling (different hours for US/India)
- Only collects during market open
- Immediate collection endpoint for manual triggers
- Configurable intervals and retention

---

---

## Part 9: Technology Justification

### Frontend Stack

| Technology | Purpose | Justification |
|-----------|---------|---------------|
| Next.js 15 | Full-stack framework | Server components, API routes, deployment |
| React 19 | UI library | Industry standard, composable components |
| TypeScript | Type safety | Prevents runtime errors in financial calculations |
| Tailwind CSS | Styling | Utility-first, consistent design, dark mode |
| Radix UI | Component library | Accessible, unstyled, full control |
| Plotly.js | 3D charting | GEX surface visualization capability |
| Recharts | 2D charts | Simple, responsive line/bar charts |
| Chart.js | Charting | Alternative chart implementation |

### Backend Stack

| Technology | Purpose | Justification |
|-----------|---------|---------------|
| Express.js | HTTP framework | Lightweight, middleware ecosystem |
| node-cron | Scheduling | Market-hour aware data collection |
| PostgreSQL | Database | Relational schema, ACID compliance |
| Axios | HTTP client | CBOE/NSE API communication |
| TypeScript | Type safety | Match frontend, prevent bugs |

---

---

## Part 10: Critical Dependencies & External APIs

### External Data Sources

1. **CBOE CDN** (US Markets)
   - Endpoint: `https://cdn.cboe.com/api/global/delayed_quotes/options/{ticker}.json`
   - Provides: Current price, option chain with Greeks
   - Format: JSON
   - Rate limit: Not specified, appears unlimited for public access
   - Latency: 15-minute delayed data (market standard)

2. **NSE API** (India Markets)
   - Endpoint: Variable per data type
   - Provides: Option chain, Greeks
   - Format: JSON
   - Rate limit: Per NSE terms of service
   - Latency: Real-time or near-real-time

### Critical npm Packages

**Frontend (30+ packages):**
- @radix-ui/* (UI components)
- react, react-dom (framework)
- next (full-stack)
- plotly.js, recharts, chart.js (charts)
- tailwindcss (styling)
- react-hook-form, zod (forms)
- next-themes (theme switching)

**Backend (7 packages):**
- express (HTTP server)
- pg (PostgreSQL driver)
- axios (HTTP client)
- node-cron (scheduling)
- dotenv (environment)
- cors (CORS middleware)
- TypeScript utilities

---

---

## Part 11: Performance Considerations

### Frontend Performance

1. **Code Splitting**
   - Next.js automatic route-based splitting
   - Chart components lazy-loaded
   - Dynamic imports for heavy libraries

2. **Caching**
   - 5-minute API response cache
   - Browser cache for assets
   - Chart computation memoization

3. **Rendering**
   - useCallback prevents unnecessary re-renders
   - useMemo for expensive calculations
   - Resizable panels for responsive layout

### Backend Performance

1. **Database**
   - Connection pooling (20 concurrent)
   - Strategic indexing on (ticker, timestamp)
   - Bulk inserts for data collection
   - JSON aggregation for efficient retrieval

2. **Memory**
   - Streaming large result sets if needed
   - Cleanup cron job prevents unbounded growth
   - Connection timeouts prevent hanging

3. **API Response**
   - CORS preflight optimization
   - Gzip compression
   - JSON response streaming

---

---

## Part 12: Security Considerations

### Current Implementation

1. **API Proxying**
   - CBOE API accessed from frontend via proxy
   - NSE API accessed similarly
   - Reduces direct client exposure

2. **CORS**
   - Whitelist allowed origins
   - Supports localhost and Vercel deployments
   - Can add additional origins as needed

3. **Database**
   - SSL connection in production
   - Connection string from environment
   - Parameterized queries (prevent SQL injection)

### Recommendations for Hardening

1. **Authentication**
   - Add user authentication layer
   - JWT tokens or session management
   - Rate limiting per user

2. **Input Validation**
   - Validate ticker symbols against whitelist
   - Validate timestamp ranges
   - Reject suspicious parameters

3. **Error Handling**
   - Don't expose database error details
   - Generic error messages to client
   - Detailed logging server-side

4. **Data Privacy**
   - Implement data retention policies
   - Encrypt sensitive calculations if needed
   - Audit logging for compliance

---

---

## Part 13: Scalability Analysis

### Current Bottlenecks

1. **Data Collection**
   - Single backend instance
   - Sequential API calls to CBOE/NSE
   - Limited to ~10 tickers per 15-minute interval

2. **Database**
   - Single PostgreSQL instance
   - 3-day retention might fill quickly
   - JSON aggregation can be slow with large result sets

3. **Frontend**
   - All calculations in browser
   - Large option chains (1000+ rows) slow rendering
   - 3D surface chart rendering expensive

### Scaling Recommendations

1. **Backend Scaling**
   - Horizontal scaling with load balancer
   - Queue-based job system (Bull, Bull-MQ)
   - Parallel ticker collection
   - Caching layer (Redis)

2. **Database Scaling**
   - Read replicas for queries
   - Time-series database option (InfluxDB)
   - Partitioning by ticker/date
   - Archive old data to cold storage

3. **Frontend Optimization**
   - Web workers for calculations
   - Virtual scrolling for large tables
   - Simplified 2D charts as default
   - Progressive enhancement

---

---

## Summary

This Gamma Exposure Dashboard is a **well-structured, full-stack application** with:

✅ **Clear separation of concerns** between presentation, business logic, and data layers
✅ **Dual-market support** (US & India) with market-aware scheduling
✅ **Real-time and historical data** with time-machine feature
✅ **Comprehensive visualization suite** for gamma exposure analysis
✅ **Type-safe implementation** with TypeScript throughout
✅ **Automated data collection** with cron-based scheduling
✅ **Responsive design** with dark/light theme support

**Current Limitations:**
- Manual state management could benefit from Redux for complex flows
- Calculations entirely frontend-side (could be optimized)
- Limited error recovery and retry logic
- Single-instance deployment model

**Redesign Ready:** The modular architecture makes it ready for complete redesign while maintaining the same data flow and API contracts.

---

**Document Generated:** 8 November 2025
**Status:** Ready for Architecture Review & Redesign Phase

