# System Overview & Macro Architecture

This document maps the global architecture of the Gamma Exposure Terminal Dashboard. It outlines how frontend and backend components interact, details the directories, and provides unified data flow sequence diagrams to serve as the master directory of truth.

---

## 🏗️ Macro-Architecture Architecture Diagram

```mermaid
graph TD
    %% Frontend Layer
    subgraph Frontend [Next.js Client-Side SPA]
        UI[React Dashboards / Charts]
        DS[lib/data-service.ts]
        API_Client[lib/backend-api.ts]
    end

    %% Backend API Gateway & Server
    subgraph Backend [Express.js API Server]
        Server[src/server.ts Router]
        Cron[node-cron Scheduler]
        BacktestEngine[src/backtester/engine.ts]
        AIService[src/services/aiAnalystService.ts]
    end

    %% Storage Layer
    subgraph Databases [Data Storage Layer]
        PG[(PostgreSQL Database)]
        DDB[(DuckDB Files / memory)]
    end

    %% External Connections
    CBOE[CBOE Options API]
    Dhan[Dhan / NSE API]
    Gemini[Gemini AI Models]

    %% Data Flow Connections
    UI <--> DS
    DS <--> API_Client
    API_Client <-->|HTTP REST API| Server
    
    Server <-->|node-postgres pool| PG
    Server <-->|duckdb bindings| DDB
    
    Cron -->|Daily SOD/EOD triggers| Server
    
    %% Service Connections
    Server <--> AIService
    AIService <-->|fetch HTTP| Gemini
    
    Server <-->|execute backtest| BacktestEngine
    BacktestEngine <--> DDB
    
    Server <--> Dhan
    Server <--> CBOE
```

---

## 🗂️ Codebase Directory Structure & Documentation Map

This project is separated into a Next.js frontend at the root and an Express.js backend inside the `backend/` folder. Use the index below to find detailed documents for each sub-system:

### 1. Root & Configuration
* [package.json](../package.json) — Frontend dependencies, Next.js build scripts.
* [tailwind.config.ts](../tailwind.config.ts) — Styling system, design tokens, color palette.
* [tsconfig.json](../tsconfig.json) — Frontend TypeScript compiler parameters.

### 2. Frontend Sub-systems
* **Detailed Guide**: **[FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md)**
* [app/](../app/) — Pages, layouts, Next.js routing.
* [components/](../components/) — Interactive UI dashboards and views.
  * [components/charts/](../components/charts/) — Recharts / Chart.js / Plotly wrappers for options metrics.
  * [components/confluence/](../components/confluence/) — Confluence matrices and 3D Surface charts.
  * [components/dashboard/](../components/dashboard/) — Performance stats dashboards.
  * [components/algorithms/](../components/algorithms/) — Backtester setups and drawer UI.
  * [components/trading-journal/](../components/trading-journal/) — Heatmaps, calendar grid, PnL charts.
* [lib/](../lib/) — Math calculation utilities, designs, and API clients.

### 3. Backend Sub-systems
* **Detailed Guide**: **[BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md)**
* [backend/package.json](../backend/package.json) — Backend dependency configuration.
* [backend/src/server.ts](../backend/src/server.ts) — Bootstrap server entry, cron setups, Express routes.
* [backend/src/services/](../backend/src/services/) — Options collection, journal syncing, and Gemini interactions.
* [backend/src/backtester/](../backend/src/backtester/) — DuckDB interface, simulation backtest loop.
* [backend/src/db/](../backend/src/db/) — Schema specifications, pool parameters, and table definitions.

### 4. Feature Guides Index
* **[features/market_data_collector.md](features/market_data_collector.md)**: Scrapers (NSE/Dhan, CBOE), Cron scheduler, Rates updating, DB Schema.
* **[features/gex_time_machine.md](features/gex_time_machine.md)**: GEX calculations math, timestamp caches, play/pause controller, visualizer charts.
* **[features/options_flow.md](features/options_flow.md)**: Sentiment models, aggregates, volume vs OI tracking.
* **[features/backtester.md](features/backtester.md)**: DuckDB database, strategy parsing, simulator engine, result plots.
* **[features/trading_journal.md](features/trading_journal.md)**: Calendar heatmaps, analytics dashboards, journal trade logs.
* **[features/ai_analyst.md](features/ai_analyst.md)**: AI trade logger, context building, Gemini chat logic.
* **[features/quant_pricing.md](features/quant_pricing.md)**: Breeden-Litzenberger implied probability density mapping, GARCH(1,1) volatility forecasting, Quantum Tunneling wall barrier breakthroughs, and CFTC COT macro positioning.

---

## ⚡ Core Integration Flows

### 1. Market Data Scraping & GEX Processing
This flow tracks the background collection and indexing of options data:

```mermaid
sequenceDiagram
    autonumber
    participant Cron as node-cron Scheduler
    participant DC as dataCollector.ts
    participant CBOE as CBOE API
    participant PG as PostgreSQL Database

    Cron->>DC: Trigger collectMarketData() (Every 5 mins)
    DC->>DC: check if US / India market is open
    alt US Market Open
        DC->>CBOE: fetchOptionChain("SPX")
        CBOE-->>DC: JSON Raw Options Chain
        DC->>DC: normalizeOptionData()
        DC->>PG: INSERT INTO option_snapshots (spot_price, timestamp)
        Note over DC,PG: Get generated snapshot_id
        DC->>PG: BULK INSERT INTO option_data (snapshot_id, strike, gamma, oi...)
    end
```

### 2. Time Machine Playback Replay
This flow traces how historical snapshots are retrieved when the user drags the Time Machine slider:

```mermaid
sequenceDiagram
    autonumber
    participant Browser as Client UI
    participant ClientAPI as backend-api.ts
    participant Router as server.ts (Express)
    participant Retrieval as dataRetrieval.ts
    participant PG as PostgreSQL Database

    Browser->>Browser: User drags timeline slider to timestamp T
    Browser->>ClientAPI: getHistoricalData("SPX", T)
    ClientAPI->>Router: GET /api/historical-data?ticker=SPX&timestamp=T
    Router->>Retrieval: getDataAtTimestamp("SPX", T)
    Retrieval->>PG: SELECT * FROM option_snapshots WHERE ticker = 'SPX' ORDER BY ABS(timestamp - T) LIMIT 1
    PG-->>Retrieval: snapshot rows (spot_price, snapshot_id)
    Retrieval->>PG: SELECT * FROM option_data WHERE snapshot_id = ID
    PG-->>Retrieval: ~2,500 Option contracts
    Retrieval->>Retrieval: Format Options List
    Retrieval-->>Router: return SnapshotData payload
    Router-->>ClientAPI: JSON Response
    ClientAPI-->>Browser: Resolve Promise
    Browser->>Browser: calculateGEX() (local client calculation)
    Browser->>Browser: Re-render Chart.js Visualizers
```

### 3. AI Chat to Trading Journal Flow
This flow tracks how natural language input results in a trade logged into the Database:

```mermaid
sequenceDiagram
    autonumber
    participant User as User Chat
    participant ChatPanel as AIChatPanel.tsx
    participant AIService as aiAnalystService.ts
    participant Gemini as Gemini Pro Model
    participant Journal as journalService.ts
    participant DB as PostgreSQL Database

    User->>ChatPanel: Type "Log a buy of 5 SPX calls at 5800 entry 4.2 exit 5.6"
    ChatPanel->>AIService: POST /api/analyst/chat { message, context }
    AIService->>Gemini: Send history + prompt + trade-logger schema instructions
    Gemini-->>AIService: Return markdown response + JSON tool-call schema
    alt Gemini detects trade logging request
        AIService->>Journal: createTrade(extractedTradeParams)
        Journal->>DB: INSERT INTO journal_trades (pnl, entry_price, strike, direction...)
        DB-->>Journal: Created Trade
        Journal-->>AIService: return Trade Record
    end
    AIService-->>ChatPanel: JSON { text, tradeLogged: TradeRecord }
    ChatPanel->>ChatPanel: Show Success Alert in Chat
    ChatPanel->>Browser: Dispatch Event (Reload Calendar / Heatmap view)
```

### 4. 0DTE Settlebomb Suggestion & Prints Recording Flow
This flow tracks the periodic logging of options engine suggestions and detailed Greeks:

```mermaid
sequenceDiagram
    autonumber
    participant Cron as node-cron Scheduler
    participant Server as server.ts (Express)
    participant PG as PostgreSQL Database

    Cron->>Server: Trigger suggestion recorder (Every 15 mins)
    Server->>PG: SELECT * FROM option_snapshots & option_data LIMIT 1 (latest chain)
    PG-->>Server: Latest Option Chain data (Bid, Ask, Greeks)
    Server->>Server: Localize GEX magnet/attractor search (within ±1.5% of spot)
    Server->>Server: Calculate Walls, Settlebomb butterfly/spread suggestion, PPI
    Server->>Server: Extract Greeks for recommended strategy legs and ATM/25D/15D long call/put options
    Server->>PG: INSERT INTO option_suggestions_history (spot, recorded_legs JSON)
    PG-->>Server: Log Success
```
