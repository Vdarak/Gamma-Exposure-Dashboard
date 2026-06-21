# Feature: Gemini AI Analyst & Trading Agent

This document details the Gemini integrations, prompt layouts, context construction, and tool function calling that power the AI Analyst.

---

## 🤖 Model & API Details

* **Model Used**: Gemini 1.5 Flash / Gemini 3.5 Flash (via REST API endpoint `generativelanguage.googleapis.com`).
* **Environment Configuration**: Active when `process.env.GEMINI_API_KEY` is set on the backend. Checked via `aiAnalystService.isEnabled()`.

---

## 📈 Context Injection (GEX + IV Compilation)

When the user queries the chatbot or triggers a market briefing, the server does not just send the raw prompt; it injects a complete, pre-compiled JSON payload containing options analytics parsed from the database snapshot:

### 1. Greeks Proxies Calculations
* **Vanna Proxy**: $\text{Vega} \cdot \text{Delta}$ (vol-delta sensitivity). Indicates if dealer delta expansions are self-amplifying during volatility spikes.
* **Charm Proxy**: $\text{Delta} \cdot \text{Theta}$ (time-decay delta decay). Indicates EOD delta drift bias.
* **0DTE Regime**: Sums GEX across $0\text{DTE}$ strikes. Categorizes as:
  * **Long Gamma**: $\text{GEX}_{0\text{DTE}} \ge 0$. Suppresses intraday volatility (pinning/reversion).
  * **Short Gamma**: $\text{GEX}_{0\text{DTE}} < 0$. Amplifies intraday volatility (momentum/expansion).

### 2. Implied Volatility (IV) Skeletal Analysis
* **ATM IV**: ATM strike closest to spot at the front-month expiry.
* **Term Structure Slope**: Compares near-term ATM IV against far-term ATM IV:
  * **Contango**: $\text{IV}_{\text{far}} > \text{IV}_{\text{near}}$
  * **Backwardation**: $\text{IV}_{\text{near}} > \text{IV}_{\text{far}}$
* **Crash Skew Steepness**: Compares the IV of a $10\%$ Out-Of-The-Money (OTM) Put against a $10\%$ OTM Call:
  * **Asymmetric Put Bid (Crash Smirk)**: $\text{Put IV} - \text{Call IV} > 5\%$
  * **Call Bid (Reverse Skew)**: $\text{Put IV} - \text{Call IV} < -3\%$
  * **Symmetric Smile**: Between $-3\%$ and $5\%$

---

## 🎛️ Tool-Calling & Agent Functions

In `processChat()`, Gemini is equipped with tool schemas to execute operations on the PostgreSQL Trading Journal database:

### 1. `log_trade`
* **Purpose**: Logs a single equity or option trade.
* **Parameters**: `ticker`, `tradeType`, `strike`, `optionType`, `expiration`, `direction` (Buy/Sell), `quantity`, `entryPrice`, `exitPrice`, `pnl`, `pnlPercent`, `quality` (S/A/B setup grade), `rationale`, `strategy`.
* **Execution**: Calls `journalService.createTrade()` and returns a styled confirmation card in the chat.

### 2. `log_batch_trades`
* **Purpose**: Logs multiple trades at once (e.g. bulk CSV imports or conversational listings).
* **Parameters**: `trades` (array of `log_trade` objects).

### 3. `view_trades`
* **Purpose**: Queries logged entries.
* **Parameters**: `tradeDate` (optional YYYY-MM-DD filter).
* **Execution**: Calls `journalService.getTrades()`, filters by date, and prints a formatted markdown list.

### 4. `delete_trade`
* **Purpose**: Deletes a journal trade by ID.
* **Parameters**: `id`.
* **Execution**: Calls `journalService.deleteTrade()`.

---

## 🧭 Structured Prompt Formats

### 1. Market Briefing Prompts (`generateBriefing`)
Instructs Gemini to output five exact markdown sections:
* `## 0DTE Gamma Regime`: Explains pinning vs momentum.
* `## Gamma Flip & Key Levels`: Lists flip, call wall, and put wall strikes.
* `## Vanna & Charm Forces`: Time decay drift and vol expansions.
* `## Gamma Concentration by Expiry`: Identifies near-term clusters.
* `## 0DTE Trade Ideas`: Suggests two concrete trade setups referencing actual strike prices.

### 2. Strategy Parser Prompt (`parseStrategy`)
Converts trade descriptions to JSON configurations. Enforces strict parsing rules:
* Indicator names must be **strictly lowercase** (e.g., `close`, `rsi_14`, `ema_50`, `sma_200`, `bb_upper_20_2`).
* Operators must be exact strings: `greater_than`, `less_than`, `equals`, `crosses_above`, `crosses_below`.
* Sets `shouldExecute` to true if simulation execution is implied by the text.
