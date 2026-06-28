import logging
from datetime import datetime, date
import numpy as np
import pandas as pd
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.backtester.engine import VectorBTEngine, sanitize_floats
from app.services.backtester.options_engine import run_options_backtest
from app.services.backtester.data_loader import DuckDBDataLoader

logger = logging.getLogger("gamma-exposure-backend.backtester.portfolio_engine")

class PortfolioBacktestEngine:
    def __init__(self, db: AsyncSession, data_loader: DuckDBDataLoader):
        self.db = db
        self.loader = data_loader
        self.equity_engine = VectorBTEngine(data_loader)

    async def run_portfolio_backtest(self, config: dict) -> dict:
        """
        Executes a multi-strategy portfolio backtest:
        - Runs individual strategies to get return vectors.
        - Iterates day-by-day to simulate portfolio NAV, Cash, Asset Values, Margin, and Leverage.
        - Triggers rebalancing based on time intervals or drift thresholds.
        """
        strategies_cfg = config.get("strategies", [])
        rebalance_freq = config.get("rebalanceFrequency", "none") # "none", "daily", "weekly", "monthly"
        drift_threshold = float(config.get("driftThresholdPercent", 0.0)) / 100.0 # e.g. 5% = 0.05
        initial_capital = float(config.get("initialCapital", 100000.0))
        start_date_str = config.get("startDate", "2023-01-01")
        end_date_str = config.get("endDate", "2023-12-31")
        benchmark_ticker = config.get("benchmark", "SPY")
        
        commission = float(config.get("commission", 0.05)) / 100.0 # Convert % to decimal
        slippage = float(config.get("slippage", 0.1)) / 100.0 # Convert % to decimal

        if not strategies_cfg:
            raise ValueError("Portfolio must contain at least one strategy configuration.")

        # 1. Run each strategy independently to fetch daily valuation series
        strategy_runs = {}
        all_timestamps = set()

        for s in strategies_cfg:
            s_id = s.get("id")
            s_type = s.get("type", "equity")
            s_ticker = s.get("ticker", "AAPL")
            s_weight = float(s.get("weight", 0.0))
            
            # Setup run config for sub-strategy
            run_cfg = {
                **s.get("config", {}),
                "ticker": s_ticker,
                "startDate": start_date_str,
                "endDate": end_date_str,
                "initialCapital": initial_capital, # run with full capital initially to extract percentage returns
                "commission": float(config.get("commission", 0.05)),
                "slippagePercent": float(config.get("slippage", 0.1))
            }

            try:
                if s_type == "equity":
                    res = await self.equity_engine.run_backtest(run_cfg)
                else:
                    # Options backtest
                    res = await run_options_backtest(self.db, run_cfg)
                
                strategy_runs[s_id] = {
                    "config": s,
                    "results": res,
                    "weight": s_weight
                }
                
                # Collect all timestamps (support both daily and intraday times)
                for pt in res.get("equityCurve", []):
                    ts = pt["timestamp"]
                    all_timestamps.add(ts)
                    
            except Exception as e:
                logger.error(f"Failed to run sub-strategy {s_id} ({s_ticker}): {e}", exc_info=True)
                raise ValueError(f"Sub-strategy {s_ticker} failed: {str(e)}")

        # Sort all timestamps chronologically
        timeline = sorted(list(all_timestamps))
        if not timeline:
            raise ValueError("No overlapping timeline data found for the strategies.")

        # Load benchmark curve (benchmarks are daily Close prices)
        min_day = timeline[0].split(" ")[0]
        max_day = timeline[-1].split(" ")[0]
        benchmark_data = self.loader.load_benchmark_data(benchmark_ticker, min_day, max_day)
        benchmark_map = {b["timestamp"]: b["close"] for b in benchmark_data}

        # Initialize portfolio state
        portfolio_curve = []
        last_rebalance_date = None
        
        # Align values for each strategy
        normalized_curves = {}
        for s_id, run in strategy_runs.items():
            curve = run["results"].get("equityCurve", [])
            val_map = {pt["timestamp"]: pt["portfolioValue"] for pt in curve}
            daily_val_map = {pt["timestamp"].split(" ")[0]: pt["portfolioValue"] for pt in curve}
            
            # Forward-fill missing timestamps
            last_val = initial_capital
            aligned = {}
            for t in timeline:
                if t in val_map:
                    last_val = val_map[t]
                else:
                    date_part = t.split(" ")[0]
                    if date_part in daily_val_map:
                        last_val = daily_val_map[date_part]
                aligned[t] = last_val
            
            normalized_curves[s_id] = aligned

        # Populate previous prices
        prev_prices = {}
        for s_id in strategy_runs:
            prev_prices[s_id] = normalized_curves[s_id][timeline[0]]

        # Initialize strategy holdings (valued in USD)
        strategy_holdings = {s_id: initial_capital * target_weights[s_id] for s_id, run in strategy_runs.items()} if False else {} # Stub, will populate below
        target_weights = {s_id: run["weight"] for s_id, run in strategy_runs.items()}
        strategy_holdings = {s_id: initial_capital * target_weights[s_id] for s_id in strategy_runs}
        portfolio_cash = initial_capital - sum(strategy_holdings.values()) # Should be 0 initially

        for idx, t in enumerate(timeline):
            # 1. Update holdings value based on sub-strategy daily returns
            total_holdings_value = 0.0
            
            for s_id in strategy_runs:
                current_price = normalized_curves[s_id][t]
                prev_price = prev_prices[s_id]
                
                # Daily return of the sub-strategy
                ret = (current_price / prev_price - 1.0) if prev_price > 0 else 0.0
                
                # Apply return to our dollar holding in that strategy
                strategy_holdings[s_id] = strategy_holdings[s_id] * (1.0 + ret)
                total_holdings_value += strategy_holdings[s_id]
                prev_prices[s_id] = current_price

            # Total Portfolio Net Asset Value (NAV) before any rebalancing on this day
            nav = portfolio_cash + total_holdings_value

            # 2. Check Rebalancing triggers
            trigger_rebalance = False
            
            # Drift-threshold trigger
            if drift_threshold > 0:
                for s_id, target_w in target_weights.items():
                    actual_w = strategy_holdings[s_id] / nav if nav > 0 else 0.0
                    if abs(actual_w - target_w) > drift_threshold:
                        trigger_rebalance = True
                        break
            
            # Time-based trigger
            if not trigger_rebalance and rebalance_freq != "none":
                dt = datetime.strptime(t, "%Y-%m-%d")
                if last_rebalance_date is None:
                    trigger_rebalance = True
                else:
                    last_dt = datetime.strptime(last_rebalance_date, "%Y-%m-%d")
                    if rebalance_freq == "daily":
                        trigger_rebalance = True
                    elif rebalance_freq == "weekly":
                        if (dt - last_dt).days >= 7 or idx % 5 == 0:
                            trigger_rebalance = True
                    elif rebalance_freq == "monthly":
                        if dt.month != last_dt.month:
                            trigger_rebalance = True

            # 3. Perform Rebalancing
            rebalance_cost = 0.0
            if trigger_rebalance:
                new_holdings = {}
                for s_id, target_w in target_weights.items():
                    target_val = nav * target_w
                    current_val = strategy_holdings[s_id]
                    diff = target_val - current_val
                    
                    # Transaction costs on the trade adjustment
                    trade_size = abs(diff)
                    rebalance_cost += trade_size * (commission + slippage)
                    
                    new_holdings[s_id] = target_val
                
                strategy_holdings = new_holdings
                portfolio_cash = portfolio_cash - rebalance_cost
                # Update NAV post-cost
                nav = portfolio_cash + sum(strategy_holdings.values())
                last_rebalance_date = t

            # 4. Calculate Option Margin Requirements
            margin_held = 0.0
            for s_id, run in strategy_runs.items():
                if run["config"].get("type") == "options":
                    opt_value = strategy_holdings[s_id]
                    # If we sold options (short premium), option value in strategy can drift to negative or we explicitly flag short
                    # Simple Reg-T option margin simulation for short option strategies:
                    is_short_strat = run["config"].get("config", {}).get("strategyType") == "short"
                    if is_short_strat or opt_value < 0:
                        margin_held += abs(opt_value) * 1.5

            # Enforce margin call if NAV goes below margin held
            margin_call_triggered = False
            if margin_held > 0 and nav < margin_held:
                margin_call_triggered = True
                # Liquidate all option positions, convert back to cash
                portfolio_cash += sum(strategy_holdings.values())
                strategy_holdings = {s_id: 0.0 for s_id in strategy_holdings}
                nav = portfolio_cash

            # 5. Record daily state
            bench_price = benchmark_map.get(t.split(" ")[0], 100.0)
            if not portfolio_curve:
                initial_bench_price = bench_price
            else:
                initial_bench_price = portfolio_curve[0]["benchPrice"]
                
            bench_return_pct = ((bench_price - initial_bench_price) / initial_bench_price) * 100.0 if initial_bench_price > 0 else 0.0

            portfolio_curve.append({
                "timestamp": t,
                "portfolioValue": nav,
                "cash": portfolio_cash,
                "equityValue": sum(val for s_id, val in strategy_holdings.items() if strategy_runs[s_id]["config"].get("type") == "equity"),
                "optionsValue": sum(val for s_id, val in strategy_holdings.items() if strategy_runs[s_id]["config"].get("type") == "options"),
                "marginHeld": margin_held,
                "marginCall": margin_call_triggered,
                "benchmarkValue": bench_price,
                "benchmarkReturn": bench_return_pct,
                "benchPrice": bench_price,
                "strategyAllocations": {s_id: val for s_id, val in strategy_holdings.items()}
            })

        # 6. Normalize benchmark curve for UI chart
        initial_nav = portfolio_curve[0]["portfolioValue"]
        initial_bench = portfolio_curve[0]["benchmarkValue"]
        
        for pt in portfolio_curve:
            pt["portfolioReturn"] = ((pt["portfolioValue"] - initial_nav) / initial_nav) * 100.0
            pt["benchmarkValueNormalized"] = (pt["benchmarkValue"] / initial_bench) * initial_nav if initial_bench > 0 else initial_nav

        # 7. Merge and scale trades
        unified_trades = []
        for s_id, run in strategy_runs.items():
            raw_trades = run["results"].get("trades", [])
            weight = run["weight"]
            for tr in raw_trades:
                unified_trades.append({
                    "strategyId": s_id,
                    "strategyName": run["config"].get("name", s_id),
                    "strategyType": run["config"].get("type", "equity"),
                    "ticker": run["config"].get("ticker"),
                    "direction": tr.get("direction", "Long"),
                    "entryDate": tr.get("entry_date") or tr.get("entryDate"),
                    "entryPrice": tr.get("entry_price") or tr.get("entryPrice"),
                    "exitDate": tr.get("exit_date") or tr.get("exitDate"),
                    "exitPrice": tr.get("exit_price") or tr.get("exitPrice"),
                    "size": tr.get("size", 1) * weight,
                    "pnl": tr.get("pnl", 0.0) * weight,
                    "returnPct": tr.get("return_pct") or tr.get("pnlPercent") or 0.0,
                    "status": tr.get("status", "Closed")
                })

        # Sort trades by entry date
        unified_trades = sorted(unified_trades, key=lambda x: x["entryDate"] or "")

        # 8. Compute portfolio-level performance metrics
        final_capital = portfolio_curve[-1]["portfolioValue"]
        total_return_pct = ((final_capital - initial_capital) / initial_capital) * 100.0
        
        days_total = (datetime.strptime(timeline[-1], "%Y-%m-%d") - datetime.strptime(timeline[0], "%Y-%m-%d")).days
        years = max(0.1, days_total / 365.25)
        cagr = ((final_capital / initial_capital) ** (1.0 / years) - 1.0) * 100.0

        max_drawdown = 0.0
        peak = initial_capital
        for pt in portfolio_curve:
            val = pt["portfolioValue"]
            if val > peak:
                peak = val
            dd = ((peak - val) / peak) * 100.0
            if dd > max_drawdown:
                max_drawdown = dd
                
        daily_navs = [pt["portfolioValue"] for pt in portfolio_curve]
        daily_rets = pd.Series(daily_navs).pct_change().dropna()
        
        sharpe = 0.0
        sortino = 0.0
        if len(daily_rets) > 1:
            mean_ret = daily_rets.mean()
            std_ret = daily_rets.std()
            daily_rf = 0.04 / 252
            
            if std_ret > 0:
                sharpe = float((mean_ret - daily_rf) / std_ret * np.sqrt(252))
                
            neg_rets = daily_rets[daily_rets < 0]
            neg_std = neg_rets.std()
            if neg_std > 0:
                sortino = float((mean_ret - daily_rf) / neg_std * np.sqrt(252))

        bench_navs = [pt["benchmarkValueNormalized"] for pt in portfolio_curve]
        bench_rets = pd.Series(bench_navs).pct_change().dropna()
        beta = 1.0
        alpha = 0.0
        
        if len(daily_rets) > 1 and len(bench_rets) > 1:
            try:
                cov = np.cov(daily_rets, bench_rets)[0][1]
                bench_var = np.var(bench_rets)
                if bench_var > 0:
                    beta = float(cov / bench_var)
                    alpha = float((daily_rets.mean() - beta * bench_rets.mean()) * 252 * 100.0)
            except Exception:
                pass

        result = {
            "initialCapital": initial_capital,
            "finalCapital": final_capital,
            "totalReturnPercent": total_return_pct,
            "cagr": cagr,
            "maxDrawdownPercent": max_drawdown,
            "sharpeRatio": sharpe,
            "sortinoRatio": sortino,
            "beta": beta,
            "alphaPercent": alpha,
            "rebalanceEvents": len([pt for pt in portfolio_curve if pt["timestamp"] == last_rebalance_date]) if last_rebalance_date else 0,
            "trades": unified_trades,
            "equityCurve": portfolio_curve,
            "benchmarkTicker": benchmark_ticker
        }
        
        return sanitize_floats(result)
