# Feature: Options Flow Analytics

This document details the calculations, sentiment indices, and timeframe comparisons that drive the Options Flow Tracker.

---

## 🕒 Options Flow Timeframe Comparison Model

Options Flow acts as a delta engine. It computes change metrics by joining the latest option data snapshots with a baseline snapshot chosen based on the selected timeframe:

1. **Intraday Flow**:
   * Baseline: The **earliest snapshot recorded on the current day** (since 12:00 AM).
   * Fallback: If only one snapshot is available for the current day, it compares against the **last snapshot of the previous trading day**.
2. **Daily Flow**:
   * Baseline: The **last snapshot of the previous trading day** (yesterday's close).
3. **5-Day Flow**:
   * Baseline: The snapshot **closest to 5 days ago**. If unavailable, it falls back to the earliest recorded snapshot in the database.
4. **Custom Flow**:
   * Baseline: The snapshot closest to a user-provided `customStartDate`.

---

## 🧮 Sentiment & Premium Calculations

For each option contract (Strike + Expiration + Type), the engine computes Open Interest (OI) changes:

$$\Delta \text{OI} = \text{OI}_{\text{latest}} - \text{OI}_{\text{baseline}}$$

### 1. Notional Change (Option Premium)
The transaction value proxy for the position change:
$$\text{Notional Change} = |\Delta \text{OI}| \cdot \text{Last Price} \cdot 100$$

### 2. Sentiment Classification Rules
The engine classifies dealer and flow sentiment based on the direction of Open Interest change:
* **Bullish Flow**:
  * **Calls Buying**: Call Open Interest increases ($\Delta \text{OI} > 0$).
  * **Puts Selling**: Put Open Interest decreases ($\Delta \text{OI} < 0$).
* **Bearish Flow**:
  * **Puts Buying**: Put Open Interest increases ($\Delta \text{OI} > 0$).
  * **Calls Selling**: Call Open Interest decreases ($\Delta \text{OI} < 0$).

### 3. Aggregates Indicators
* **Total Call/Put Volume**: Aggregated trading volume for all calls/puts.
* **Put/Call Volume Ratio**: $\frac{\text{Total Put Volume}}{\text{Total Call Volume}}$
* **Net Bullish Sentiment %**:
$$\text{Bullish Sentiment \%} = \frac{\text{Bullish Premium}}{\text{Bullish Premium} + \text{Bearish Premium}} \cdot 100$$
* **Dominant Sentiment Label**:
  * **Bullish**: $\text{Bullish Sentiment \%} > 55\%$
  * **Bearish**: $\text{Bullish Sentiment \%} < 45\%$
  * **Neutral**: Between $45\%$ and $55\%$
* **Top Notional Strikes**: The top 5 strikes ranked by highest absolute `Notional Change`.

---

## 🖥️ Frontend Implementation

The frontend Options Flow tab is handled by the **[OptionFlowDashboard](../../components/option-flow-dashboard.tsx)** component:

1. **Flow Stream Table**: Renders the complete feed of option flow items including Strike, Contract, Expiration, Spot Price, Price Change %, OI, Volume, DTE, and Notional Change.
2. **Sentiment Aggregates Cards**: Displays Bullish Sentiment percentage dials, Put/Call ratios, and total volume bars.
3. **Top Strikes Grid**: Lists the top 5 strikes absorbing the most option premium change.
4. **Historical Flow Trend Chart (`flow-historical-view.tsx`)**: Plots the cumulative daily volume and sentiment shifts over time.
5. **AI Briefing Card (`AIAnalystPanel`)**: Shows AI-generated bullet summaries of the ticker's options activity.
