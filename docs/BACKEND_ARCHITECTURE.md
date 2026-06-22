# Backend Architecture

This document outlines the architecture, data management, background workers, and API layers of the Gamma Exposure Terminal backend.

---

## ⚙️ Core Express Server Setup

The backend is built as a Node.js service using **TypeScript** and **Express.js** (`backend/src/server.ts`).

### Middleware Configuration
1. **CORS Configuration**: Matches client origins including local servers (`http://localhost:3000`, `3002`, `5173`) and Vercel preview/production deployments (`https://gamma-exposure-dashboard.vercel.app`, and `*.vercel.app` dynamically via regex matcher).
2. **JSON Parser**: Parses incoming HTTP request bodies via `express.json()`.
3. **Request Logger**: Custom middleware logs incoming HTTP requests (timestamp, method, and route path). To prevent logs clutter, it excludes high-frequency polling endpoints `/health`, `/api/current-data`, and `/api/timestamps`.

---

## 🗂️ Database & Storage Engines

The backend uses a hybrid storage model:

### 1. PostgreSQL (Dealers GEX snapshots + Trading Journal)
* **Client Driver**: `pg` (node-postgres Pool) defined under [connection.ts](../backend/src/db/connection.ts).
* **Usage**: Storing option snapshots (`option_snapshots` and `option_data` tables) and user trade entries (`journal_trades` table).
* **Initialization**: Schema migrations and database connections are checked at boot via `initializeDatabase()` in [init.ts](../backend/src/db/init.ts).

### 2. DuckDB (Historical Backtesting Engine)
* **Client Driver**: Native Node.js `duckdb` bindings.
* **Usage**: Reading high-volume historical trade logs and options metrics to simulate strategy backtests without impacting PostgreSQL performance.
* **Files**: Interfaced via [duckdbService.ts](../backend/src/backtester/duckdbService.ts).

---

## ⏰ Cron Scheduled Tasks

Automated tasks are scheduled using `node-cron`:

1. **Option Chain Scraping (`*/5 * * * *`)**
   * Runs **every 5 minutes**.
   * Checks current market hours:
     * **US Markets**: 9:30 AM to 4:00 PM EST (not weekends).
     * **India Markets**: 9:15 AM to 3:30 PM IST (converted to UTC equivalent, not weekends).
   * Fetches, normalizes, and stores option chain data for active markets.
2. **Interest Rates Scraper (`0 3,10,13,20 * * *`)**
   * Runs **4 times daily** (at SOD and EOD for both markets: 03:00, 10:30, 13:00, and 20:30 UTC).
   * Fetches risk-free rates (US yields and Indian G-Sec) to use in options calculations (e.g. Delta, IV).

---

## 🔌 API Endpoints Map

| Endpoint | Method | Params / Body | Backend Handler / Service | Description |
|:---|:---:|:---|:---|:---|
| `/health` or `/api/health` | `GET` | None | Internal route | Health check. Returns status, timestamp, uptime |
| `/api/rates` | `GET` | None | `ratesService.ts` | Fetches stored US & India risk-free interest rates |
| `/api/current-data` | `GET` | `ticker` | `dataRetrieval.ts` -> `getCurrentData()` | Gets the latest options chain snapshot for a ticker. Scrapes CBOE synchronously if empty |
| `/api/options/flow` | `GET` | `ticker`, `timeframe`, `startDate` | `optionsFlowService.ts` -> `getOptionsFlowData()` | Returns options flow items (OI, Volume diffs) and sentiment aggregates |
| `/api/analyze` | `GET` | `ticker`, `timeframe` | `aiAnalystService.ts` -> `generateBriefing()` | Uses Gemini to write a ticker market briefing |
| `/api/analyst/chat` | `POST` | `{ message, history, ticker, livePrice, uiContext, is0DteMode }` | `aiAnalystService.ts` -> `processChat()` | Chats with the analyst agent. Triggers tool-calls (e.g. logging journal trades) |
| `/api/gex-flow` | `GET` | `ticker`, `date` | `dataRetrieval.ts` -> `getIntradayGexFlow()` | Retrieves intraday 0DTE GEX flow slice by strike |
| `/api/historical-gex` | `GET` | `ticker` | `dataRetrieval.ts` -> `getHistoricalGexTrend()` | Gets 30-day historical closing GEX trend data |
| `/api/historical-data` | `GET` | `ticker`, `timestamp`, `startDate`, `endDate`, `hoursBack` | `dataRetrieval.ts` -> `getHistoricalData()` | Retrieves snapshot records filtered by hour count, range, or specific timestamp |
| `/api/timestamps` | `GET` | `ticker`, `days` | `dataRetrieval.ts` -> `getAvailableTimestamps()` | Gets list of available options snapshot timestamps |
| `/api/stats` | `GET` | `ticker` (optional) | `dataRetrieval.ts` -> `getDataStatistics()` | Returns PG database metrics (snapshot counts, size, etc.) |
| `/api/expiries` | `GET` | `ticker`, `timestamp` (optional) | `dataRetrieval.ts` -> `getAvailableExpiries()` | Gets listed expiration dates for a specific snapshot |
| `/api/backtest/tickers` | `GET` | None | `duckdbService.ts` -> `getAvailableTickers()` | Lists tickers loaded in DuckDB backtest files |
| `/api/backtest/ticker-info`| `GET` | `ticker` | `duckdbService.ts` -> `getTickerDateRange()` | Gets start and end dates of available backtesting data |
| `/api/backtest/parse-strategy`| `POST`| `{ description }` | `aiAnalystService.ts` -> `parseStrategy()` | Parses plain English rules into JSON backtest configs |
| `/api/backtest/run` | `POST` | Config JSON | `engine.ts` -> `runBacktest()` | Runs backtest options simulation and returns results |
| `/api/journal/trades` | `GET` | None | `journalService.ts` -> `getTrades()` | Lists all user journal trade entries |
| `/api/journal/trades` | `POST` | Trade JSON | `journalService.ts` -> `createTrade()` | Adds a new trade record to PostgreSQL |
| `/api/journal/trades/:id`| `PUT` | Partial Trade JSON | `journalService.ts` -> `updateTrade()` | Edits details of an existing journal entry |
| `/api/journal/trades/:id`| `DELETE`| None | `journalService.ts` -> `deleteTrade()` | Deletes a trade from the journal |
| `/api/journal/settings/:key`| `GET` | None | `journalService.ts` -> `getSetting()` | Gets configuration setting value by key |
| `/api/journal/settings/:key`| `PUT` | `{ value }` | `journalService.ts` -> `updateSetting()` | Updates configuration setting value by key |
| `/api/quant/probability-map`| `GET` | `ticker`, `expiration` (optional) | `quantEngineService.ts` -> `getProbabilityMap()` | Solves Breeden-Litzenberger risk-neutral terminal price PDF |
| `/api/quant/garch-forecast` | `GET` | `ticker` | `quantEngineService.ts` -> `getGarchForecast()` | Computes MLE grid-search GARCH(1,1) volatility forecast |
| `/api/quant/quantum-tunneling`| `GET`| `ticker` | `quantEngineService.ts` -> `getQuantumTunneling()` | Computes quantum tunneling wall barrier breakthrough stats |
| `/api/quant/cot-flow`       | `GET` | `ticker` (optional) | `quantEngineService.ts` -> `getHistoricalCot()` | Retrieves weekly CFTC Commitments of Traders positions |
| `/api/collect-now`          | `POST`| None | `dataCollector.ts` | Triggers immediate scraper scrape for all tickers |
