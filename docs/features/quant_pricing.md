# Feature: Quant Pricing & Risk Suite

This document details the mathematical theories, backend models, and frontend visualizations that power the Quant Pricing suite. This suite includes the Breeden-Litzenberger Implied Probability Map, GARCH(1,1) Volatility Forecasting, Quantum Tunneling Barrier Analysis, and Commitment of Traders (COT) Macro positioning flow.

---

## 🗺️ Breeden-Litzenberger Implied Probability Map

The Implied Probability Map extracts the risk-neutral probability density function (PDF) of the underlying asset price at a future expiration date directly from option chain prices.

### 1. Mathematical Foundation
Under the Breeden-Litzenberger (1978) theorem, the risk-neutral PDF $f(K)$ of the underlying price at option maturity $T$ is proportional to the second partial derivative of the call option price $C(S, K, T)$ with respect to the strike price $K$:

$$f(K) = e^{r \cdot T} \frac{\partial^2 C}{\partial K^2}$$

Where:
* $r$: Risk-free interest rate (fetched daily from Yahoo Finance yields).
* $T$: Time to expiration in years.
* $C$: Call option price.

### 2. Numerical Estimation Pipeline (`quantEngineService.ts`)
* **Strike Grid Expansion**: The service constructs a dense, evenly spaced strike grid (120 points) ranging from $58\%$ to $132\%$ of the current spot price.
* **Implied Volatility Smile Interpolation**: Implied volatility (IV) is linearly interpolated across the grid from the sparse set of active options strikes in the database.
* **Option Pricing**: Call prices are calculated for every strike on the dense grid using the Black-Scholes formula with the interpolated IV.
* **Finite Differences Derivative**: The second derivative is approximated numerically using central differences:

$$\frac{\partial^2 C}{\partial K^2} \approx \frac{C(K + \Delta K) - 2C(K) + C(K - \Delta K)}{(\Delta K)^2}$$

* **Normalizing Probability Mass**: Any negative densities (which can arise from numerical noise or arbitrage-violating option prices) are truncated to $0$, and the resulting PDF is normalized so the total probability mass integrates to $1.0$ ($\sum f(K) \Delta K = 1$).
* **Statistical Moments**:
  * **Mean**: Expected terminal price under the risk-neutral measure.
  * **Standard Deviation**: Risk-neutral volatility.
  * **Skewness**: Left/right asymmetry (downside crash fear bid).
  * **Kurtosis**: Fat-tailedness (extreme tail risk).
  * **Pin Strike**: Strike price matching the peak of the probability distribution.

---

## 📈 GARCH(1,1) Volatility Forecasting

The GARCH (Generalized Autoregressive Conditional Heteroskedasticity) engine forecasts future volatility term structures based on historical price returns and compares it with option implied volatilities.

### 1. Model Specifications
The GARCH(1,1) model updates variance conditional on past returns and past variances:

$$\sigma_t^2 = \omega + \alpha \cdot r_{t-1}^2 + \beta \cdot \sigma_{t-1}^2$$

Subject to constraints:
* $\omega > 0, \alpha \ge 0, \beta \ge 0$
* Stability condition: $\alpha + \beta < 1$ (typically bounded at $0.99$ to avoid non-stationary variances).
* Unconditional variance: $V = \frac{\omega}{1 - \alpha - \beta}$.

### 2. Implementation & Optimization Loop
* **Returns Loading**: Fetches 1 year of daily historical closing prices from Yahoo Finance and calculates daily log returns: $r_t = \ln(S_t / S_{t-1})$.
* **MLE Grid-Search Optimizer**: Performs Maximum Likelihood Estimation (MLE) over a grid of parameters ($\alpha \in [0.01, 0.22]$ and $\beta \in [0.70, 0.96]$) to find the parameters maximizing the joint log-likelihood of the observed returns:

$$\ln L = \sum_{t=1}^N -0.5 \left( \ln(2\pi) + \ln(\sigma_t^2) + \frac{r_t^2}{\sigma_t^2} \right)$$

* **Horizon Forecasting**: Forecasts cumulative conditional variance and annualized volatility for future horizons (1 to 90 days) using the recursive expectation:

$$E_t[\sigma_{t+k}^2] = V + (\alpha + \beta)^k (\sigma_t^2 - V)$$

* **Term Structure Comparison**: Renders the forecasted GARCH curve alongside the option chain's Implied Volatility (IV) term structure. Divergences highlight options pricing opportunities (e.g. overvalued/undervalued premiums).

---

## 🌀 Quantum Tunneling Wall Analysis

This feature treats options market dealer walls (major Call and Put GEX levels) as quantum potential barriers, modeling the probability of spot prices breaking through ("tunneling") these levels.

### 1. Quantum Analogy & Transmission
* **Spot Volatility as Kinetic Energy ($E$)**: Daily return standard deviation is mapped as the spot price's kinetic energy.
* **Dealer GEX as Potential Barrier ($U$)**: 
  * **Positive GEX (Call Wall)**: Models a stabilizing gamma-hedging zone. This represents a tall potential barrier that repels spot prices, causing pinning or price reversion.
  * **Negative GEX (Put Wall)**: Models a destabilizing short gamma zone. This represents a magnetic/vacuum barrier, leading to price attraction and acceleration once reached.
* **Transmission Coefficient**: The tunneling breakthrough probability is estimated using the transmission coefficient approximation:

$$P_{\text{breakthrough}} = \exp(-2 \cdot \kappa \cdot d)$$

Where:
* $d$: Normalized distance between spot price and the wall.
* $\kappa$: Barrier decay constant, scaled by wall GEX relative to average strike GEX.

---

## 🌾 Commitment of Traders (COT) Macro Flow

The COT module parses weekly CFTC reports to overlay institutional vs retail positioning trends on major macro assets.

* **Macro Asset List**: Tracks indices, metals, energies, and bonds (`SPX`, `NDX`, `GLD`, `SLV`, `USO`, `TNX`, `DXY`, `IWM`).
* **Position Categories**:
  * **Speculators / Non-Commercials**: Large leveraged hedge funds and asset managers.
  * **Commercials**: Dealers, market makers, and physical hedgers.
  * **Retail / Small Reportables**: Retail trader proxy.
* **Weekly Change Tooltip**: The frontend interactive bar charts embed dynamic tooltips. Hovering over a date column renders a popover with:
  * The CFTC report date.
  * Side-by-side vertical comparisons of speculator, commercial, and retail net long/short contract changes compared to the prior week.

---

## 🖥️ UI Components & Visualizations

The Quant Pricing sub-tabs are organized inside [gamma-exposure-dashboard.tsx](file:///Users/vedantsmacmini/Desktop/Code/Gamma%20Exposure%20Indicator/gamma-exposure-dashboard/components/gamma-exposure-dashboard.tsx):

1. **Probability Map Chart (`probability-map-chart.tsx`)**: Plots the Breeden-Litzenberger terminal price PDF. Includes dropdowns to select expiries, overlays spot price, and displays statistical moments (mean, skewness, kurtosis).
2. **GARCH Forecast Chart (`garch-forecast-chart.tsx`)**: Renders GARCH conditional volatility forecast curves plotted against option-chain ATM implied volatilities across days-to-expiry (DTE). Restricted to a compact height of `h-[450px]` to maintain page layout cleanliness.
3. **Quantum Tunneling (`quantum-tunneling-gauge.tsx`)**: Displays speedometers/gauges showing breakthrough probabilities for the nearest Call and Put walls, alongside descriptive status labels ("Strong Pin", "Magnetic"). Mounted alongside a rotated, collapsed candlestick chart reference.
4. **COT Flow Chart (`cot-flow-chart.tsx`)**: A time series area chart of net positioning. Integrates a cursor-tracking D3.js tooltip overlay displaying CFTC report dates and weekly change graphs.
