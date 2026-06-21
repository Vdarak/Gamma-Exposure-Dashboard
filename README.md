# Gamma Exposure Terminal Dashboard

An advanced, institutional-grade options analysis suite that tracks, calculates, and visualizes real-time Gamma Exposure (GEX), Options Flow, Implied Volatility (IV) Surfaces, and risk metrics. It features a Time Machine mode to replay market history, an AI Analyst agent that logs trades automatically, a fully integrated Trading Journal, and a historical backtester powered by DuckDB.

---

## 🛠️ Quick Start & Local Development

### 1. Requirements
* Node.js (v18+ recommended)
* PostgreSQL (for snapshot/journal storage)
* Optional: Gemini API Key (for AI chat and trading agents)

### 2. Environment Setup
* **Frontend**: Duplicate `.env.example` in the root directory to `.env.local` and set configuration.
* **Backend**: Duplicate `.env.example` in the `backend/` directory to `.env` and fill in DB credentials, AI API keys, and server port.

### 3. Install Dependencies
You can install dependencies in the root and backend folders using your package manager (e.g., `pnpm`, `npm`, or `yarn`):
```bash
# Install frontend dependencies
pnpm install

# Install backend dependencies
cd backend
pnpm install
```

### 4. Run Locally
To run both systems in development mode, open two terminal windows:

* **Backend Dev Server**:
  ```bash
  cd backend
  pnpm run dev
  ```
  *(Starts on `http://localhost:3001` by default)*

* **Frontend Next.js App**:
  ```bash
  pnpm run dev
  ```
  *(Starts on `http://localhost:3000`)*

---

## 📚 Codebase Documentation System

A comprehensive, modular documentation system is provided in the `docs/` folder to serve as the single source of truth for developers and AI models:

* **[docs/SYSTEM_OVERVIEW.md](docs/SYSTEM_OVERVIEW.md)**: Main developer entry point. High-level architecture, directory layout, unified data flows, and documentation mapping.
* **[docs/FRONTEND_ARCHITECTURE.md](docs/FRONTEND_ARCHITECTURE.md)**: Frontend macro-architecture, App Router, component layout, and client-side calculations.
* **[docs/BACKEND_ARCHITECTURE.md](docs/BACKEND_ARCHITECTURE.md)**: Express.js server, node-cron tasks, database layers, and API route mappings.
* **[docs/features/](docs/features/)**: Detailed files mapping individual application subsystems:
  * [Market Data Ingestion](docs/features/market_data_collector.md)
  * [GEX Calculation & Time Machine](docs/features/gex_time_machine.md)
  * [Options Flow analytics](docs/features/options_flow.md)
  * [DuckDB Backtest Engine](docs/features/backtester.md)
  * [Trading Journal](docs/features/trading_journal.md)
  * [AI Analyst Agent](docs/features/ai_analyst.md)

---

## ⚡ Deployment
* **Backend**: Containerized via Docker / Nixpacks and deployed to **Railway** (configured via `backend/railway.json`).
* **Frontend**: Deployed to **Vercel** as a static / serverless Next.js application.
