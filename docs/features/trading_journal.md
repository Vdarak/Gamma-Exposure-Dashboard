# Feature: Trading Journal & Analytics

This document details the database schema, business logic, UI layouts, and automated integrations that power the Trading Journal.

---

## 🗄️ Database Service CRUD Layer

The backend interfaces with PostgreSQL for all journal entries via **[journalService.ts](../../backend/src/services/journalService.ts)**:

* **CRUD Functions**:
  * `getTrades()`: Retrieves all trades ordered by `trade_date DESC` and `time_entered DESC`.
  * `getTradeById(id)`: Fetches a single trade record.
  * `createTrade(trade)`: Inserts a new trade row.
  * `updateTrade(id, trade)`: Performs a SQL update statement for altered fields.
  * `deleteTrade(id)`: Deletes a trade row by unique ID.
* **Row Normalization (`mapRowToTrade`)**:
  * Converts database date stamps into local `YYYY-MM-DD` strings.
  * Slices Postgres time string (e.g. `09:30:00` into `09:30`).
  * Converts numeric fields (strike, quantity, pnl, entry/exit prices) into float numbers.

---

## ⚙️ Account Balance Settings

Journal configuration is logged in the `journal_settings` table:
* Benchmarks and initial balance are stored using a key-value structure.
* **Key `start_balance`**: Represents the initial portfolio cash balance (seeded to `2566.19` by default) to compute cumulative performance percentages.
* Mapped via `/api/journal/settings/:key`.

---

## 🖥️ Frontend Journal Views

The Trading Journal interface is composed inside **[TradingJournal](../../components/trading-journal/trading-journal.tsx)**:

### 1. Spreadsheet Log (`trading-journal.tsx`)
* Displays a list of logged trades (Ticker, Date, Entry Time, Trade Type, Strike, Direction, Quality, Quantity, Price, Net P&L).
* Includes controls to open edit modals or delete logs.

### 2. Calendar grid (`calendar-view.tsx`)
* A monthly day-grid view mapping trade counts.
* Highlights winning days in green and losing days in red, along with cumulative daily PnL summaries.

### 3. Heatmap View (`heatmap.tsx`)
* An interactive grid calendar representing daily profits using color saturation gradients (darker green represents larger profits, darker red represents larger losses).

### 4. Trade Entry Editor (`trade-form.tsx`)
* Configures trade inputs (Trade date, Entry/Exit times, Asset type: Equity vs Options, strike, size, buy/sell direction, trade setup grade quality: S, A, B, and gross prices).
* **Screenshots**: Supports loading a screenshot image, compressing it to a Base64 string, and saving it directly in the PostgreSQL database (`screenshot` column).

### 5. Journal Performance Analytics (`analytics.tsx`)
* Renders metrics and charts detailing:
  * Cumulative P&L curve over time.
  * Win Rate percentage and Profit Factor.
  * Trade setup performance comparison.
  * Trade setup grade quality metrics (e.g., checking if Grade "S" trades perform better than Grade "B" trades).

---

## 🤖 AI Automated Logging Integration

The journal is linked directly to the AI Chat Panel sidebar:
1. When a user types a trade instruction in the chat (e.g., *"Log a buy of 10 TSLA calls at 200 entry 3.5 exit 4.2"*), the message is processed by `/api/analyst/chat`.
2. The AI Analyst Service interprets the text. If a trade log request is identified, it extracts the trade parameter fields (Ticker, direction, type, size, entry, exit).
3. The server calls `createTrade()` to insert the trade in PostgreSQL automatically.
4. The API response includes the newly created `tradeLogged` JSON.
5. Upon receiving this response, the frontend chat window displays a confirmation card and dispatches a page-reload event, updating the calendar grid, heatmap, and spreadsheet in real-time.
