# Feature: GEX Calculations & Time Machine Replay

This document details the mathematical algorithms and UI playback systems that drive the Gamma Exposure (GEX) analytics and the time-travel playback engine.

---

## 🧮 GEX & Greeks Mathematical Models

The application performs GEX and Greek calculations using two pricing models in **[lib/calculations.ts](../../lib/calculations.ts)**:

### 1. Black-Scholes Model (European Options)
Used by default for most calculations. The absolute GEX for a single option contract is computed as:
$$\text{GEX} = \text{Open Interest} \cdot 100 \cdot S^2 \cdot 0.01 \cdot \Gamma$$

Where:
* $S$: Current spot price of the underlying asset.
* $\Gamma$ (Gamma): Option Gamma, derived as:
$$\Gamma = \frac{e^{-q \cdot T} \cdot n(d_1)}{S \cdot \sigma \cdot \sqrt{T}}$$
* $n(d_1)$: Standard normal PDF evaluated at $d_1 = \frac{\ln(S / K) + (r - q + 0.5 \cdot \sigma^2) \cdot T}{\sigma \cdot \sqrt{T}}$.
* $q$: Dividend yield.
* $r$: Risk-free interest rate.
* $\sigma$: Annualized Implied Volatility (IV).
* $T$: Time to expiration in years.

Dealers Net Exposure perspective:
* **Calls**: Treated as **Positive GEX** (dealers buy underlying on rallies, sell on drops).
* **Puts**: Treated as **Negative GEX** (dealers sell underlying on drops, buy on rallies).

### 2. Binomial Tree Model (American Options)
Used when pricing American-style options where early exercise features affect the delta and gamma.
* Built using a **Cox-Ross-Rubinstein (CRR)** binomial tree (defaulting to 100 steps).
* Up ($u$) and down ($d$) factors: $u = e^{\sigma \cdot \sqrt{dt}}$, $d = \frac{1}{u}$.
* Risk-neutral probability: $p = \frac{e^{r \cdot dt} - d}{u - d}$.
* Iterates backward, taking the maximum of continuation value and intrinsic value at each step.
* **Greeks Delta ($\Delta$) & Gamma ($\Gamma$)** are calculated using **Finite Differences** (bumping spot price by $\pm1\%$):
$$\Delta = \frac{V(S + dS) - V(S - dS)}{2 \cdot dS}$$
$$\Gamma = \frac{\Delta(S + dS) - \Delta(S - dS)}{2 \cdot dS}$$

---

## 🔍 GEX Key Levels Sweep Calculations

### 1. Expected Move
Estimated range of underlying movement derived from option 16-delta strangles (representing approximately a 1-standard deviation range):
* Loops over available expiries.
* Finds Call contract closest to $+0.16$ Delta.
* Finds Put contract closest to $-0.16$ Delta.
* The upper and lower bounds of these strikes represent the expected range bounds.

### 2. Zero Gamma Level (Gamma Flip)
The spot price level at which net GEX transitions from positive (long gamma) to negative (short gamma):
* Sweeps spot prices across a range from $80\%$ to $120\%$ of current spot (using a 30-point grid).
* Calculates cumulative Net GEX (Calls GEX minus Puts GEX) at each hypothetical spot level.
* Locates the crossing point where GEX changes sign.
* Applies linear interpolation between the two nearest boundary strikes to calculate the precise Zero Gamma price.

---

## ⏱️ Time Machine Playback Engine

The **[enhanced-time-machine.tsx](../../components/enhanced-time-machine.tsx)** controller is mounted at the dashboard footer, enabling playback:

1. **Timestamps Cache**: On active ticker change, frontend queries `/api/timestamps` to load all valid snapshots available in PostgreSQL.
2. **Timeline Slider**: Coordinates matching index points to timestamps. Dragging the slider requests the database snapshot at that specific time.
3. **Play / Pause Player**: A Javascript interval timer triggers sequential ticks through the timestamp array.
4. **Playback Speed**: Configurable intervals (e.g. 1s per snapshot, 2s, 5s).
5. **Live / Historical Mode Toggle**:
   * **Live Mode**: Subscribes to short-polling fetches of real-time CBOE/NSE chains.
   * **Historical Mode**: Replays static PostgreSQL records.

---

## 📈 Charts & Visualizations

Charts are organized under the Synced Strike Workspace which coordinates hover and zoom coordinates:

1. **GEX By Strike Chart (`gex-by-strike-chart.tsx`)**: Renders a vertical or horizontal bar chart showing call exposure (green) and put exposure (red) grouped by strike.
2. **Call/Put Walls Chart (`call-put-walls-chart.tsx`)**: Plots strikes with the largest single Call and Put open interest.
3. **Gamma Ramp (`gamma-ramp-chart.tsx`)**: Displays cumulative GEX across strikes to show where dealer gamma hedging accelerates.
4. **3D IV Surface (`iv-surface-chart.tsx`)**: A 3D mesh surface plot rendered via Plotly.js mapping Strike Price ($x$), Expiration Days ($y$), and Implied Volatility ($z$), highlighting skew and term structure.
