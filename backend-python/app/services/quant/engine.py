import numpy as np
import pandas as pd
from datetime import date, datetime, timedelta
from typing import List, Dict, Any, Optional
from scipy.interpolate import interp1d
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.models.quant import SpotPriceHistory, InterestRate, QuantForecast
from app.models.option_snapshot import OptionSnapshot, OptionData
from app.services.greeks.engine import GreeksEngine
from arch import arch_model

class QuantEngineService:
    """
    Advanced financial math suite:
    - GARCH(1,1) Volatility Forecasting (via arch package)
    - Breeden-Litzenberger Implied Probability Density Map
    - Quantum Tunneling Wall Breakthrough Probabilities
    """
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    # ── GARCH(1,1) Volatility Forecasting ──

    async def get_garch_forecast(self, ticker: str) -> Dict[str, Any]:
        """
        Fits a GARCH(1,1) model to historical spot returns and projects forward volatility horizons.
        """
        # 1. Fetch historical spot prices from database
        result = await self.db.execute(
            select(SpotPriceHistory)
            .where(SpotPriceHistory.ticker == ticker)
            .order_by(desc(SpotPriceHistory.timestamp))
            .limit(260)  # ~1 year of trading days
        )
        spot_rows = result.scalars().all()
        
        # Fallback to fetching from yfinance if database has insufficient rows
        if len(spot_rows) < 30:
            print(f"   [GARCH] Insufficient spot history in DB ({len(spot_rows)} rows). Fetching from yfinance...")
            from app.services.ingestion.yahoo import YahooFinanceService
            yahoo = YahooFinanceService(self.db)
            await yahoo.fetch_and_store_spot_history(ticker, days=365)
            
            # Re-fetch
            result = await self.db.execute(
                select(SpotPriceHistory)
                .where(SpotPriceHistory.ticker == ticker)
                .order_by(desc(SpotPriceHistory.timestamp))
                .limit(260)
            )
            spot_rows = result.scalars().all()

        if len(spot_rows) < 30:
            return {"success": False, "error": "Insufficient historical data for GARCH."}

        # Order chronologically (oldest first)
        prices = [float(row.spot_price) for row in reversed(spot_rows)]
        
        # Calculate daily log returns
        returns = np.diff(np.log(prices))
        
        # Fit GARCH(1,1) model
        # arch package works best when returns are rescaled (e.g. multiplied by 100 to make them %)
        rescaled_returns = returns * 100
        
        try:
            model = arch_model(rescaled_returns, vol='Garch', p=1, q=1, dist='normal', rescale=False)
            fit_res = model.fit(disp='off')
            
            # Extract parameters (scale back to decimal variance)
            omega = float(fit_res.params['omega']) / 10000.0
            alpha = float(fit_res.params['alpha[1]'])
            beta = float(fit_res.params['beta[1]'])
            
            # Current/last conditional variance
            last_var = float(fit_res.conditional_volatility[-1] ** 2) / 10000.0
            unconditional_var = float(fit_res.params['omega'] / (10000.0 * (1.0 - alpha - beta)))
            
        except Exception as e:
            # Fallback to standard grid-search or simple parameters if optimizer fails to converge
            print(f"   [GARCH] MLE Optimization failed, using robust defaults: {e}")
            var = np.var(returns)
            alpha = 0.05
            beta = 0.90
            omega = var * (1.0 - alpha - beta)
            last_var = var
            unconditional_var = var

        unconditional_vol = np.sqrt(unconditional_var) * np.sqrt(252)

        # Variance forecast projections
        # E_t[var_{t+k}] = V + (alpha + beta)^k-1 * (var_{t+1} - V)
        garch_vol_forecasts = []
        horizons = [1, 5, 10, 15, 20, 30, 60, 90]
        
        # Next-step variance
        var_t1 = omega + alpha * (returns[-1] ** 2) + beta * last_var

        for h in horizons:
            cumulative_var = 0.0
            for k in range(1, h + 1):
                # Expected variance at step k
                expected_var_k = unconditional_var + ((alpha + beta) ** (k - 1)) * (var_t1 - unconditional_var)
                cumulative_var += expected_var_k
                
            avg_daily_var = cumulative_var / h
            annualized_horizon_vol = np.sqrt(avg_daily_var) * np.sqrt(252)
            garch_vol_forecasts.append({
                "horizonDays": h,
                "forecastedVol": annualized_horizon_vol
            })

        # Get option term structure for comparison
        option_term_structure = await self.get_option_term_structure(ticker)

        # Cache forecast results
        try:
            # Check for caching daily
            stmt = select(QuantForecast).where(
                QuantForecast.ticker == ticker,
                QuantForecast.forecast_date == date.today()
            )
            cache_check = await self.db.execute(stmt)
            if cache_check.scalar_one_or_none() is None:
                db_forecast = QuantForecast(
                    ticker=ticker,
                    forecast_date=date.today(),
                    garch_vol_10d=garch_vol_forecasts[2]["forecastedVol"], # 10D
                    garch_vol_20d=garch_vol_forecasts[4]["forecastedVol"], # 20D
                    garch_vol_30d=garch_vol_forecasts[5]["forecastedVol"], # 30D
                    omega=omega,
                    alpha=alpha,
                    beta=beta,
                    unconditional_vol=unconditional_vol
                )
                self.db.add(db_forecast)
                await self.db.commit()
        except Exception as e:
            print(f"   [GARCH] Failed to cache forecast: {e}")
            await self.db.rollback()

        return {
            "success": True,
            "ticker": ticker.upper(),
            "unconditionalVol": unconditional_vol,
            "alpha": alpha,
            "beta": beta,
            "omega": omega,
            "garchVolForecasts": garch_vol_forecasts,
            "optionTermStructure": option_term_structure
        }

    async def get_option_term_structure(self, ticker: str) -> List[Dict[str, Any]]:
        """Helper to get average IV term structure from the current options chain."""
        # Find latest snapshot ID
        snap_result = await self.db.execute(
            select(OptionSnapshot)
            .where(OptionSnapshot.ticker == ticker)
            .order_by(desc(OptionSnapshot.timestamp))
            .limit(1)
        )
        snap = snap_result.scalar_one_or_none()
        if not snap:
            return []

        # Fetch option data grouped by expiry
        data_result = await self.db.execute(
            select(OptionData)
            .where(OptionData.snapshot_id == snap.id, OptionData.implied_volatility > 0.01)
        )
        options = data_result.scalars().all()
        
        if not options:
            return []

        df = pd.DataFrame([{
            "expiry": opt.expiration.date() if isinstance(opt.expiration, datetime) else opt.expiration,
            "iv": float(opt.implied_volatility)
        } for opt in options])

        grouped = df.groupby("expiry")["iv"].mean().reset_index()
        
        today = date.today()
        option_term_structure = []
        for _, row in grouped.iterrows():
            exp_date = row["expiry"]
            days = max(1, (exp_date - today).days)
            option_term_structure.append({
                "daysToExpiry": days,
                "expiration": exp_date.isoformat(),
                "averageIv": float(row["iv"])
            })

        return sorted(option_term_structure, key=lambda x: x["daysToExpiry"])

    # ── Breeden-Litzenberger PDF Solver ──

    async def get_probability_map(self, ticker: str, target_expiry: Optional[str] = None) -> Dict[str, Any]:
        """
        Solves the risk-neutral probability density function (PDF) via the Breeden-Litzenberger formula.
        """
        # 1. Fetch latest option chain snapshot
        snap_result = await self.db.execute(
            select(OptionSnapshot)
            .where(OptionSnapshot.ticker == ticker)
            .order_by(desc(OptionSnapshot.timestamp))
            .limit(1)
        )
        snap = snap_result.scalar_one_or_none()
        if not snap:
            return {"success": False, "error": f"No current option snapshot found for {ticker}"}

        spot = float(snap.spot_price)
        market = snap.market

        # Fetch option data
        data_result = await self.db.execute(
            select(OptionData).where(OptionData.snapshot_id == snap.id)
        )
        options = data_result.scalars().all()
        if not options:
            return {"success": False, "error": f"Snapshot {snap.id} contains no option contracts"}

        # 2. Resolve risk-free interest rate
        rate_key = "INDIA_RISK_FREE" if market == "IND" else "US_RISK_FREE"
        rate_result = await self.db.execute(
            select(InterestRate.rate).where(InterestRate.rate_key == rate_key)
        )
        r = float(rate_result.scalar() or (0.065 if market == "IND" else 0.0525))

        # Group by expiration
        expiry_groups = {}
        for opt in options:
            exp_str = opt.expiration.date().isoformat() if hasattr(opt.expiration, 'date') else str(opt.expiration)
            if exp_str not in expiry_groups:
                expiry_groups[exp_str] = []
            expiry_groups[exp_str].append(opt)

        today = date.today()
        expiries = sorted([exp for exp in expiry_groups.keys() if datetime.fromisoformat(exp).date() >= today])
        if not expiries:
            expiries = sorted(list(expiry_groups.keys()))
            
        if not expiries:
            return {"success": False, "error": "No valid expiries found."}

        active_expiry = target_expiry if (target_expiry and target_expiry in expiries) else expiries[0]

        expiries_data = []
        for exp in expiries:
            opts_for_exp = expiry_groups[exp]
            opts_for_exp.sort(key=lambda x: float(x.strike))

            exp_date = datetime.fromisoformat(exp).date()
            T = max(1e-5, (exp_date - today).days / 365.0)

            # Build a dense strike grid from 58% to 132% of spot
            min_strike = spot * 0.58
            max_strike = spot * 1.32
            grid_points = 120
            strikes_grid = np.linspace(min_strike, max_strike, grid_points)
            dK = strikes_grid[1] - strikes_grid[0]

            # Extract strikes and IVs
            market_strikes = [float(o.strike) for o in opts_for_exp]
            market_ivs = [float(o.implied_volatility or 0.20) for o in opts_for_exp]

            # Interpolate IV onto the dense strike grid
            try:
                # Linear interpolation with boundary clamping
                iv_interp = interp1d(market_strikes, market_ivs, kind='linear', fill_value=(market_ivs[0], market_ivs[-1]), bounds_error=False)
                interpolated_ivs = iv_interp(strikes_grid)
            except Exception:
                # Fallback if interpolation fails
                interpolated_ivs = np.full(grid_points, 0.20)

            # Compute Black-Scholes call prices
            call_prices = []
            for k, iv in zip(strikes_grid, interpolated_ivs):
                greeks = GreeksEngine.calculate_bs_greeks(S=spot, K=k, T=T, r=r, sigma=iv, option_type='C')
                call_prices.append(greeks["price"])

            # Compute numerical second derivative: d2C / dK2
            pdf = []
            cumulative_sum = 0.0

            pdf.append({
                "strike": float(strikes_grid[0]),
                "density": 0.0,
                "cumulative": 0.0,
                "pctOffset": float(((strikes_grid[0] - spot) / spot) * 100.0)
            })

            # numerical derivative
            for i in range(1, grid_points - 1):
                c_prev = call_prices[i - 1]
                c_curr = call_prices[i]
                c_next = call_prices[i + 1]

                d2C = (c_next - 2.0 * c_curr + c_prev) / (dK * dK)
                d2C = max(0.0, d2C)  # Arbitrage-free floor

                # Breeden-Litzenberger: f(K) = e^(r T) * d2C / dK2
                density = math.exp(r * T) * d2C
                cumulative_sum += density * dK

                pdf.append({
                    "strike": float(strikes_grid[i]),
                    "density": float(density),
                    "cumulative": float(cumulative_sum),
                    "pctOffset": float(((strikes_grid[i] - spot) / spot) * 100.0)
                })

            pdf.append({
                "strike": float(strikes_grid[-1]),
                "density": 0.0,
                "cumulative": float(cumulative_sum),
                "pctOffset": float(((strikes_grid[-1] - spot) / spot) * 100.0)
            })

            # Normalize PDF
            total_mass = sum(p["density"] * dK for p in pdf)
            if total_mass > 0:
                cumulative = 0.0
                for p in pdf:
                    p["density"] = p["density"] / total_mass
                    cumulative += p["density"] * dK
                    p["cumulative"] = min(1.0, cumulative)

            # Statistical moments
            mean = sum(p["strike"] * p["density"] * dK for p in pdf)
            variance = sum(((p["strike"] - mean) ** 2) * p["density"] * dK for p in pdf)
            std_dev = np.sqrt(variance)
            
            skewness = 0.0
            kurtosis = 0.0
            if std_dev > 0.0:
                skewness = sum((((p["strike"] - mean) / std_dev) ** 3) * p["density"] * dK for p in pdf)
                kurtosis = sum((((p["strike"] - mean) / std_dev) ** 4) * p["density"] * dK for p in pdf)

            # Find Mode (pinStrike)
            max_dens = -1.0
            pin_strike = spot
            for p in pdf:
                if p["density"] > max_dens:
                    max_dens = p["density"]
                    pin_strike = p["strike"]

            expiries_data.append({
                "expiration": exp,
                "daysToExpiry": int(T * 365),
                "mean": mean,
                "stdDev": std_dev,
                "skewness": skewness,
                "kurtosis": kurtosis,
                "pinStrike": pin_strike,
                "pdf": pdf
            })

        active_data = next((d for d in expiries_data if d["expiration"] == active_expiry), expiries_data[0])

        return {
            "success": True,
            "ticker": ticker.upper(),
            "expiration": active_expiry,
            "availableExpiries": expiries,
            "spotPrice": spot,
            "mean": active_data["mean"],
            "stdDev": active_data["stdDev"],
            "skewness": active_data["skewness"],
            "kurtosis": active_data["kurtosis"],
            "pinStrike": active_data["pinStrike"],
            "pdf": active_data["pdf"],
            "expiries": expiries_data
        }

    # ── Quantum Tunneling Wall Breakthroughs ──

    async def get_quantum_tunneling(self, ticker: str, expiries: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Calculates call and put walls based on options positioning, and computes Schrödinger-like tunneling probability.
        """
        # 1. Fetch latest snapshot
        snap_result = await self.db.execute(
            select(OptionSnapshot)
            .where(OptionSnapshot.ticker == ticker)
            .order_by(desc(OptionSnapshot.timestamp))
            .limit(1)
        )
        snap = snap_result.scalar_one_or_none()
        if not snap:
            return {"success": False, "error": f"No current option snapshot found for {ticker}"}

        spot = float(snap.spot_price)
        market = snap.market

        # Fetch option data
        data_result = await self.db.execute(
            select(OptionData).where(OptionData.snapshot_id == snap.id)
        )
        options = data_result.scalars().all()
        if not options:
            return {"success": False, "error": f"Snapshot {snap.id} contains no option contracts"}

        # Filter by expiries if requested
        if expiries:
            options = [o for o in options if (o.expiration.date().isoformat() if hasattr(o.expiration, 'date') else str(o.expiration)) in expiries]
            if not options:
                return {"success": False, "error": "No option data matched the selected expiries"}

        # Fetch rate
        rate_key = "INDIA_RISK_FREE" if market == "IND" else "US_RISK_FREE"
        rate_result = await self.db.execute(
            select(InterestRate.rate).where(InterestRate.rate_key == rate_key)
        )
        r = float(rate_result.scalar() or (0.065 if market == "IND" else 0.0525))

        # Compute GEX/walls
        # Group by strikes
        strike_gex = {}
        for opt in options:
            strike = float(opt.strike)
            if strike not in strike_gex:
                strike_gex[strike] = {"callGex": 0.0, "putGex": 0.0, "totalGex": 0.0}
            
            # Compute dte
            today = date.today()
            exp_date = opt.expiration.date() if hasattr(opt.expiration, 'date') else opt.expiration
            dte = max(0, (exp_date - today).days)
            
            exposures = GreeksEngine.calculate_exposures(
                spot=spot,
                strike=strike,
                dte=dte,
                option_type=opt.option_type,
                open_interest=opt.open_interest,
                implied_volatility=float(opt.implied_volatility or 0.20),
                risk_free_rate=r
            )

            gex_val = exposures["gex_proxy"]
            
            if opt.option_type == "C":
                strike_gex[strike]["callGex"] += gex_val
            else:
                strike_gex[strike]["putGex"] += gex_val
            strike_gex[strike]["totalGex"] += gex_val

        # Sort strikes
        sorted_strikes = []
        for strike, val in strike_gex.items():
            sorted_strikes.append({
                "strike": strike,
                "callGex": val["callGex"],
                "putGex": val["putGex"],
                "totalGex": val["totalGex"]
            })
            
        if not sorted_strikes:
            return {"success": False, "error": "No strikes parsed for tunneling calculations."}

        # Call Wall: highest call GEX strike nearest to spot price
        call_walls = sorted([s for s in sorted_strikes if s["callGex"] > 0], key=lambda x: x["callGex"], reverse=True)[:5]
        top_call_wall = sorted(call_walls, key=lambda x: abs(x["strike"] - spot))[0] if call_walls else sorted_strikes[0]

        # Put Wall: highest put GEX (magnitude) strike nearest to spot price
        put_walls = sorted([s for s in sorted_strikes if s["putGex"] < 0], key=lambda x: x["putGex"])[:5]
        top_put_wall = sorted(put_walls, key=lambda x: abs(x["strike"] - spot))[0] if put_walls else sorted_strikes[0]

        # Calculate daily return volatility E (use default 1.2% daily vol)
        E = 0.012

        # Average GEX to gauge barrier height relative to standard size
        avg_gex_val = sum(abs(s["totalGex"]) for s in sorted_strikes) / len(sorted_strikes)

        def calculate_tunneling(wall_strike: float, wall_gex: float) -> Dict[str, Any]:
            distance = abs(spot - wall_strike) / spot
            barrier_height = max(0.1, abs(wall_gex) / (avg_gex_val or 1.0))
            
            if wall_gex > 0:
                # Positive GEX = Stabilizing Pin
                kappa = np.sqrt(barrier_height)
                prob = np.exp(-2.5 * kappa * (distance * 100.0))
                status = "Strong Pin / Resistance"
            else:
                # Negative GEX = Magnetic Accelerator
                prob = 0.85 * np.exp(-1.5 * (distance * 100.0))
                status = "Magnetic / Accelerating"
                
            prob = max(0.01, min(0.99, float(prob)))

            return {
                "strike": wall_strike,
                "gexBillions": wall_gex,
                "distancePoints": abs(spot - wall_strike),
                "distancePercent": distance * 100.0,
                "barrierStrength": barrier_height,
                "breakthroughProbability": prob,
                "status": status
            }

        call_wall_metrics = calculate_tunneling(top_call_wall["strike"], top_call_wall["callGex"])
        put_wall_metrics = calculate_tunneling(top_put_wall["strike"], top_put_wall["putGex"])

        return {
            "success": True,
            "ticker": ticker.upper(),
            "spotPrice": spot,
            "averageDailyVolatility": E * 100.0,
            "callWall": call_wall_metrics,
            "putWall": put_wall_metrics
        }
