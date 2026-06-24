# Feature: Market Data Ingestion & Collector

This document describes the mechanics of option chain data scraping, parsing, Greeks calculation, risk-free interest rates tracking, and database schemas.

---

## 🛰️ Scrapers & APIs

The project supports automated data collection for two major markets:

### 1. US Markets Options Scraper (CBOE)
* **Ticker list**: `SPX`, `GLD`, `TSLA` (extensible via `.env` variable `US_TICKERS`).
* **Source**: CBOE delayed quotes JSON feeds:
  * Primary URL: `https://cdn.cboe.com/api/global/delayed_quotes/options/${ticker}.json`
  * Fallback URL: `https://cdn.cboe.com/api/global/delayed_quotes/options/_${ticker}.json` (with underscore prefix).
* **Headers/Security**: Implements connection-pooling and mimics standard desktop browsers (e.g., custom user-agent, referers, and random query-parameters `?_=${requestId}`) to prevent CloudFront 403 blocks. Includes retry logic with exponential backoff.

### 2. Indian Markets Options Scraper (NSE & Dhan API)
* **Ticker list**: `NIFTY`, `BANKNIFTY`, `RELIANCE` (extensible via `.env` variable `INDIA_TICKERS`).
* **Primary Source (Dhan API)**: Officially integrated broker API. If credentials are present, fetched via `dhanService.ts`.
* **Fallback Source (NSE Scraper)**: Scrapes option chains directly from the NSE website:
  * **Step 1 (Session cookies)**: Hit `https://www.nseindia.com/option-chain` to retrieve fresh session cookies (`set-cookie` header).
  * **Step 2 (Contract metadata)**: Use those cookies to call `https://www.nseindia.com/api/option-chain-contract-info?symbol=${ticker}` and read available expiries.
  * **Step 3 (Options payload)**: Fetch `option-chain-v3` per expiry and combine rows:
    * Index symbols: `https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=${ticker}&expiry=${expiry}`
    * Equity symbols: `https://www.nseindia.com/api/option-chain-v3?type=Equity&symbol=${ticker}&expiry=${expiry}`
  * **Expiry window control**: By default, all expiries returned by NSE contract-info are fetched. Set `.env` variable `NSE_MAX_EXPIRIES` to a positive integer (or `all`) to explicitly cap (or force all) expiry fetches.
  * **Post-processing**: Rows are deduplicated by `(expiryDate, strikePrice)` before normalization/storage.

---

## 🧮 Indian Options Greeks (Black-Scholes calculation)

Unlike CBOE, the NSE API does **not** provide option Greeks (Delta, Gamma, Theta, Vega). Therefore, the backend calculates them on-the-fly inside the data collection loop using the **Black-Scholes pricing model**:

```typescript
function calculateBlackScholesGreeks(
  S: number,      // Spot price
  K: number,      // Strike price
  T: number,      // Time to expiration in years (Expiration - Now) / 365
  r: number,      // Risk-free rate
  sigma: number,  // Implied volatility (from NSE)
  type: 'C' | 'P' // Option type
)
```

### Mathematical Greeks Formulations Used:
* **d1**: $\frac{\ln(S / K) + (r + 0.5 \cdot \sigma^2) \cdot T}{\sigma \cdot \sqrt{T}}$
* **d2**: $d_1 - \sigma \cdot \sqrt{T}$
* **Standard normal cumulative distribution function (CDF)** $N(x)$ and probability density function (PDF) $n(x)$ are approximated client-side.
* **Delta ($\Delta$)**:
  * **Call**: $N(d_1)$
  * **Put**: $N(d_1) - 1$
* **Gamma ($\Gamma$)**: $\frac{n(d_1)}{S \cdot \sigma \cdot \sqrt{T}}$
* **Theta ($\Theta$)**:
  * **Call**: $\frac{-\frac{S \cdot n(d_1) \cdot \sigma}{2 \cdot \sqrt{T}} - r \cdot K \cdot e^{-r \cdot T} \cdot N(d_2)}{365}$
  * **Put**: $\frac{-\frac{S \cdot n(d_1) \cdot \sigma}{2 \cdot \sqrt{T}} + r \cdot K \cdot e^{-r \cdot T} \cdot N(-d_2)}{365}$
* **Vega ($V$)**: $\frac{S \cdot n(d_1) \cdot \sqrt{T}}{100}$ (Returns value for a $1\%$ change in IV)

---

## ⏰ Risk-Free Rates Scraper (`ratesService.ts`)

To feed the Black-Scholes Greeks engine, the server updates risk-free rates daily:

1. **US Risk-Free Rate**: Fetches current yield of **US 3-Month Treasury Bills** (`^IRX` symbol on Yahoo Finance). Falls back to **5.25%** on error.
2. **India Risk-Free Rate**: Fetches current yield of **India 10Y Government Bond** (`IN10Y.NS` on Yahoo Finance). Falls back to **6.50%** (RBI Repo Rate benchmark) on error.
3. **Database Logging**: Rates are upserted into the `interest_rates` table.

---

## 📊 Database Schema Map (PostgreSQL)

Below are the primary tables specified in [schema.sql](../../backend/src/db/schema.sql):

### 1. `option_snapshots`
Logs the metadata for each option chain collection run.
* `id` (`SERIAL PRIMARY KEY`): Unique identifier.
* `ticker` (`VARCHAR(10)`): e.g., 'SPX'.
* `timestamp` (`TIMESTAMP`): Time of data collection.
* `spot_price` (`DECIMAL(12,4)`): Spot/underlying price at collection time.
* `data_count` (`INTEGER`): Total options parsed.
* `market` (`VARCHAR(10)`): 'USA' or 'INDIA'.

### 2. `option_data`
Holds specific contract prices and Greeks.
* `id` (`SERIAL PRIMARY KEY`): Unique identifier.
* `snapshot_id` (`INTEGER REFERENCES option_snapshots(id) ON DELETE CASCADE`): Relates back to snapshot.
* `strike` (`DECIMAL(12,4)`): Option Strike Price.
* `option_type` (`CHAR(1) CHECK (C, P)`): Call or Put.
* `expiration` (`DATE`): Expiry date.
* `last_price`, `bid`, `ask` (`DECIMAL(12,4)`): Prices.
* `volume` (`INTEGER`): Total traded contract volume.
* `open_interest` (`INTEGER`): Active open contracts.
* `implied_volatility` (`DECIMAL(12,6)`): Option IV.
* `delta`, `gamma`, `theta`, `vega`, `rho` (`DECIMAL`): Option Greeks.
* `change_in_oi` (`INTEGER`): Signed change in Open Interest (NSE specific).
* `total_buy_qty`, `total_sell_qty` (`INTEGER`): Bids vs Asks quantities (NSE specific).

### 3. `interest_rates`
Logs benchmark yields.
* `rate_key` (`VARCHAR(30) UNIQUE`): 'US_RISK_FREE' or 'INDIA_RISK_FREE'.
* `rate` (`DECIMAL(8,6)`): Yield as decimal (e.g. 0.0525).
* `source` (`VARCHAR(100)`): Query path string.

### 4. `gex_by_strike` (VIEW)
Calculates absolute option GEX per strike-row for quick rendering:
```sql
CREATE OR REPLACE VIEW gex_by_strike AS
SELECT 
  s.ticker, s.timestamp, s.spot_price,
  o.snapshot_id, o.strike, o.option_type, o.expiration,
  o.open_interest, o.gamma, o.volume, o.implied_volatility,
  (CASE WHEN o.option_type = 'C' THEN 1 ELSE -1 END) 
    * s.spot_price * s.spot_price * o.gamma * o.open_interest * 100 AS gex
FROM option_snapshots s
JOIN option_data o ON s.id = o.snapshot_id;
```

### 5. `cot_positions`
Holds weekly Commitments of Traders institutional positioning metrics.
* `id` (`SERIAL PRIMARY KEY`): Unique row identifier.
* `ticker` (`VARCHAR(10) NOT NULL`): Watched macro assets like `SPX`, `NDX`, `GLD`, `SLV`, `USO`, `TNX`, `DXY`, `IWM`.
* `report_date` (`DATE NOT NULL`): The CFTC report date.
* `open_interest` (`INTEGER NOT NULL DEFAULT 0`): Combined contract Open Interest.
* `noncomm_long`, `noncomm_short` (`INTEGER NOT NULL`): Large Speculator / Funds positioning.
* `comm_long`, `comm_short` (`INTEGER NOT NULL`): Commercial / Dealer Hedger positioning.
* `retail_long`, `retail_short` (`INTEGER NOT NULL`): Retail / Small Speculator positioning.
* `UNIQUE(ticker, report_date)` constraint handles duplicate collection runs.

---

## 🌾 Commitment of Traders (COT) Macro Ingestor (`cotIngestionService.ts`)

The COT Ingestor collects institutional positioning reports published weekly by the CFTC:

1. **Scraping Trigger (`Saturdays at 4:00 AM UTC`)**: Weekly cron job retrieves the raw text data feed from `https://www.cftc.gov/dea/newcot/deafut.txt`.
2. **Historical Seeding**: If the database lacks historical reports, the service fetches archive ZIP files for years 2025 and 2026 (`deacot2025.zip` / `deacot2026.zip`) directly from the CFTC archives, extracts them using `adm-zip`, and feeds them into the PG pool.
3. **Data Mapping**: Normalizes CFTC market names to unified macro indexes (e.g. `E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE` maps to `SPX`).
4. **Calculations**: Compares current position weights against prior weeks to compute signed weekly changes (`positioningStats.changes`) for speculative, retail, and commercial hedgers.

