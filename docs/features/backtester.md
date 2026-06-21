# Feature: DuckDB Backtesting Engine

This document outlines the design and operations of the historical backtesting simulator, which queries local high-performance datasets using DuckDB and executes simulated option strategies.

---

## 🗄️ Database & Data Ingestion (DuckDB)

The backtesting framework uses an in-memory **DuckDB instance** with Node.js bindings (`duckdbService.ts`) to query historical stock data:

* **Parquet / CSV Storage**: Reads daily and intraday 1-minute historical prices under the project's data folders:
  * Daily: `backend/data/alpha_vantage/parquet/equities/daily_adjusted/*.parquet` (or CSV equivalent).
  * Intraday: `backend/data/alpha_vantage/parquet/equities/intraday/[TICKER]/1min/*.parquet` (or CSV equivalent).
* **On-the-fly Time Bucket Aggregations**: For timeframes other than 1-minute (e.g. 5m, 15m, 30m, 1h), DuckDB aggregates raw 1-minute bars using group-by buckets:
```sql
WITH grouped_bars AS (
  SELECT 
    time_bucket(INTERVAL '15 minutes', timestamp) AS bucket_time,
    timestamp, open, high, low, close, volume
  FROM read_parquet([files])
  WHERE timestamp >= 'start_date' AND timestamp <= 'end_date'
)
...
```

---

## ⚙️ Precomputing Technical Indicators

Before running the simulation, the engine calculates the requested indicator metrics across the price bars inside `backend/src/backtester/indicators.ts`:
* Moving Averages: SMA, EMA
* Oscillators: RSI, MACD
* Volatility bands: Bollinger Bands, ATR (Average True Range)
* Returns lists of computed numbers mapped to each price bar index (`indicatorSeries`).

---

## 🏎️ Simulation Execution Loop (`engine.ts`)

The simulator loops through price bars chronologically (starting at index 1 to avoid lookahead bias). At each step, it checks portfolio status:

### 1. Position Entry Rules
* Evaluates entry condition rules using precalculated indicators.
* Logic operators supported: `>`, `<`, `=`, `crosses_above`, `crosses_below`.
* **Execution**:
  * **Long Entry**: Spends cash to purchase shares at `close` price. Adjusts execution price upward by `slippagePercent` and subtracts `commission`.
  * **Short Entry**: Sells shares short, adding proceeds to cash. Adjusts price downward by `slippagePercent` and subtracts `commission`.

### 2. Risk Management & Exit Triggers
If a position is active, the engine monitors price bounds:
* **Stop Loss**: Triggers if price crosses the stop boundary ($1 - \text{stopLossPercent}$ for long; $1 + \text{stopLossPercent}$ for short).
* **Take Profit**: Triggers if price meets the target limit ($1 + \text{takeProfitPercent}$ for long; $1 - \text{takeProfitPercent}$ for short).
* **Trailing Stop**: 
  * **Long**: Tracks the highest high reached since entry. If price falls below a percentage threshold from that peak, it triggers.
  * **Short**: Tracks the lowest low reached since entry. If price rises above a percentage threshold from that valley, it triggers.
* **Time-based Exit**: Closes the trade if `barsHeld` exceeds `timeBasedExitDays`.
* **Indicator Exit**: Triggers if custom technical conditions evaluate to true.
* **EOD Force Close**: Any remaining open position at the last bar of the dataset is automatically liquidated to ensure clean ledger metrics.

---

## 📈 Performance & Risk Metrics Calculated

Upon backtest completion, the engine computes a comprehensive set of performance ratios:

* **Profit Factor**: $\frac{\text{Sum of all Wins}}{\text{Sum of all Losses}}$
* **Calmar Ratio (Return-to-Drawdown)**: $\frac{\text{Total Return \%}}{\text{Max Drawdown \%}}$
* **Sharpe Ratio (Annualized Trade-by-trade)**: 
$$\text{Sharpe} = \frac{\mu_{\text{returns}}}{\sigma_{\text{returns}}} \cdot \sqrt{252}$$
* **Max Drawdown Duration**: Peak-to-recovery time calculated by tracking peak portfolio equity and locating recovery timestamps.
* **Streaks**: Maximum consecutive winning and losing trade streaks.
* **Expectancy**: $\text{Win Rate} \cdot \text{Avg Win} - \text{Loss Rate} \cdot \text{Avg Loss}$.

---

## 🧠 AI Strategy Parser (`aiAnalystService.ts`)

Users can describe a strategy in plain English (e.g. *"Buy TSLA when 50 EMA crosses above 200 EMA, set 2% stop"*). 
* The server sends this prompt to the Gemini API (`/api/backtest/parse-strategy`).
* Gemini uses function calling/structured schema instructions to output a valid `BacktestConfig` JSON payload containing parsed indicators, entry parameters, and stop rules.

---

## 🖥️ Backtesting UI Panels

The backtester is structured inside **[BacktestDashboard](../../components/algorithms/backtest-dashboard.tsx)**:
1. **[BacktestConfigForm](../../components/algorithms/backtest-config-form.tsx)**: Configures parameters, dates, capitals, and hosts the English strategy parsing prompt.
2. **[BacktestCharts](../../components/algorithms/backtest-charts.tsx)**: Plots the portfolio equity curve relative to the underlying asset close price (buy-and-hold benchmark).
3. **[BacktestMetricsGrid](../../components/algorithms/backtest-metrics-grid.tsx)**: Formats stats (Sharpe, Calmar, Win Rate, Expectancy, drawdowns) into clean UI status cards.
4. **[BacktestTradeLog](../../components/algorithms/backtest-trade-log.tsx)**: Renders a paginated trade journal spreadsheet listing each trade's entry/exit, profit/loss, and exit reason.
