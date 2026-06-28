import pandas as pd
import numpy as np
import vectorbt as vbt
import logging
from datetime import datetime
from app.services.backtester.data_loader import DuckDBDataLoader
from app.services.backtester.indicators import compute_indicators
from app.services.backtester.strategy_builder import compile_rules

logger = logging.getLogger("gamma-exposure-backend.backtester.engine")

def sanitize_floats(obj):
    """
    Recursively replaces np.nan, np.inf, -np.inf with None or float representations.
    """
    if isinstance(obj, dict):
        return {k: sanitize_floats(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_floats(x) for x in obj]
    elif isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    elif isinstance(obj, np.floating):
        val = float(obj)
        if np.isnan(val) or np.isinf(val):
            return None
        return val
    elif isinstance(obj, np.integer):
        return int(obj)
    return obj

class VectorBTEngine:
    def __init__(self, data_loader: DuckDBDataLoader):
        self.loader = data_loader

    async def run_backtest(self, config: dict) -> dict:
        """
        Executes a vectorized backtest strategy using VectorBT and pandas-ta.
        """
        ticker = config.get("ticker", "SPX")
        timeframe = config.get("timeframe", "1d")
        start_date = config.get("startDate", "2020-01-01")
        end_date = config.get("endDate", "2023-12-31")
        initial_capital = float(config.get("initialCapital", 10000))
        commission = float(config.get("commission", 0.0)) / 100.0  # Convert % to fraction
        slippage = float(config.get("slippagePercent", 0.0)) / 100.0 # Convert % to fraction
        
        # 1. Load OHLCV data using DuckDB
        bars = self.loader.load_historical_data(ticker, timeframe, start_date, end_date)
        if len(bars) < 2:
            raise ValueError(f"Insufficient historical data found for ticker {ticker} in range {start_date} to {end_date}")
            
        df = pd.DataFrame(bars)
        
        # 2. Compute technical indicators
        indicator_configs = config.get("indicators", [])
        df_indicators = compute_indicators(df, indicator_configs)
        
        # 3. Compile entry/exit signals
        entry_rules = config.get("entryRules", {}).get("indicators", [])
        exit_rules = config.get("exitRules", {}).get("indicators", [])
        
        entries = compile_rules(df_indicators, entry_rules)
        exits = compile_rules(df_indicators, exit_rules)
        
        # 4. Parse stop loss, take profit, trailing stop
        sl_val = config.get("exitRules", {}).get("stopLossPercent")
        tp_val = config.get("exitRules", {}).get("takeProfitPercent")
        ts_val = config.get("exitRules", {}).get("trailingStopPercent")
        
        sl_stop = sl_val / 100.0 if (sl_val is not None and sl_val > 0) else None
        tp_stop = tp_val / 100.0 if (tp_val is not None and tp_val > 0) else None
        ts_stop = ts_val / 100.0 if (ts_val is not None and ts_val > 0) else None
        
        # 5. Run Portfolio Simulation
        is_short = config.get("strategyType") == "short"
        
        if is_short:
            pf = vbt.Portfolio.from_signals(
                close=df_indicators["close"],
                short_entries=entries,
                short_exits=exits,
                init_cash=initial_capital,
                fees=commission,
                slippage=slippage,
                sl_stop=sl_stop,
                tp_stop=tp_stop,
                sl_trail=ts_stop,
                freq=timeframe
            )
        else:
            pf = vbt.Portfolio.from_signals(
                close=df_indicators["close"],
                entries=entries,
                exits=exits,
                init_cash=initial_capital,
                fees=commission,
                slippage=slippage,
                sl_stop=sl_stop,
                tp_stop=tp_stop,
                sl_trail=ts_stop,
                freq=timeframe
            )
            
        # 6. Extract performance metrics
        stats = pf.stats()
        
        # Build trade log
        trades_list = []
        trade_markers = []
        
        try:
            records = pf.trades.records
            if records is not None and len(records) > 0:
                if isinstance(records, pd.DataFrame):
                    records_list = records.to_dict('records')
                else:
                    records_list = [dict(zip(records.dtype.names, row)) for row in records]
                    
                for idx, r in enumerate(records_list):
                    # In VectorBT, records contain: entry_idx, exit_idx, entry_price, exit_price, pnl, return
                    # Fetch timestamps
                    entry_idx = int(r["entry_idx"])
                    exit_idx = int(r["exit_idx"])
                    
                    entry_date = df_indicators.iloc[entry_idx]["timestamp"]
                    exit_date = df_indicators.iloc[exit_idx]["timestamp"] if exit_idx < len(df_indicators) else df_indicators.iloc[-1]["timestamp"]
                    
                    pnl_val = float(r["pnl"])
                    ret_pct = float(r["pnl"]) / (float(r["entry_price"]) * float(r["size"])) * 100.0 if r["entry_price"] > 0 else 0.0
                    
                    # Compute duration in days/bars
                    duration = int(exit_idx - entry_idx)
                    
                    direction_str = "Short" if is_short else "Long"
                    status_str = "Closed" if int(r["status"]) == 1 else "Open"
                    
                    trade_record = {
                        "id": idx + 1,
                        "direction": direction_str,
                        "entry_date": entry_date,
                        "entry_price": float(r["entry_price"]),
                        "exit_date": exit_date,
                        "exit_price": float(r["exit_price"]),
                        "size": float(r["size"]),
                        "pnl": pnl_val,
                        "return_pct": ret_pct,
                        "duration_days": duration,
                        "status": status_str
                    }
                    trades_list.append(trade_record)
                    
                    # Trade markers for charts
                    trade_markers.append({
                        "timestamp": entry_date,
                        "type": "buy" if not is_short else "sell",
                        "price": float(r["entry_price"]),
                        "text": f"Entry {direction_str} @ {float(r['entry_price'])}"
                    })
                    
                    if status_str == "Closed":
                        trade_markers.append({
                            "timestamp": exit_date,
                            "type": "sell" if not is_short else "buy",
                            "price": float(r["exit_price"]),
                            "text": f"Exit {direction_str} @ {float(r['exit_price'])}"
                        })
        except Exception as e:
            logger.error(f"Error compiling trades log: {e}")

        # Build equity curve
        equity_series = pf.value()
        benchmark_series = df_indicators["close"] / df_indicators["close"].iloc[0] * initial_capital
        
        equity_curve = [
            {
                "timestamp": df_indicators.iloc[i]["timestamp"],
                "portfolioValue": float(equity_series.iloc[i]),
                "price": float(df_indicators.iloc[i]["close"]),
                "benchmarkValue": float(benchmark_series.iloc[i])
            }
            for i in range(len(df_indicators))
        ]
        
        # Build drawdown curve
        dd_series = pf.drawdown() * 100.0 # Convert fraction to percent
        drawdown_curve = [
            {
                "timestamp": df_indicators.iloc[i]["timestamp"],
                "drawdown_pct": float(dd_series.iloc[i])
            }
            for i in range(len(df_indicators))
        ]
        
        # Build daily returns distribution
        daily_returns = pf.returns().fillna(0.0).tolist()
        
        # Gather indicators overlay
        indicators_overlay = {}
        for col in df_indicators.columns:
            if col not in ["timestamp", "open", "high", "low", "close", "volume"]:
                # Replace NaNs with None for JSON serialization
                indicators_overlay[col] = df_indicators[col].replace({np.nan: None}).tolist()
                
        # Reconstruct standard OHLCVSeries format
        ohlcv = {
            "timestamp": df_indicators["timestamp"].tolist(),
            "open": df_indicators["open"].tolist(),
            "high": df_indicators["high"].tolist(),
            "low": df_indicators["low"].tolist(),
            "close": df_indicators["close"].tolist(),
            "volume": df_indicators["volume"].tolist()
        }
        
        # Map stats Series values safely
        def get_stat(key, default=0.0):
            val = stats.get(key)
            if val is None or pd.isna(val):
                return default
            if isinstance(val, pd.Timedelta):
                return float(val.days)
            try:
                return float(val)
            except (ValueError, TypeError):
                return default

        final_capital = get_stat("End Value", initial_capital)
        total_pnl = final_capital - initial_capital
        avg_pnl = float(np.mean([t["pnl"] for t in trades_list])) if trades_list else 0.0
        avg_pnl_percent = float(np.mean([t["return_pct"] for t in trades_list])) if trades_list else 0.0
        median_pnl = float(np.median([t["pnl"] for t in trades_list])) if trades_list else 0.0
        max_dd = get_stat("Max Drawdown [%]")
        return_to_dd = (total_pnl / initial_capital * 100.0) / max_dd if max_dd > 0 else 0.0

        result_dict = {
            "ticker": ticker,
            "startDate": start_date,
            "endDate": end_date,
            "period_days": int(get_stat("Period")),
            "timeframe": timeframe,
            "strategy_name": config.get("strategyType", "long"),
            "initialCapital": initial_capital,
            "finalCapital": final_capital,
            "totalReturnPercent": get_stat("Total Return [%]"),
            "benchmark_return_pct": get_stat("Benchmark Return [%]"),
            "totalFees": get_stat("Total Fees Paid"),
            "maxDrawdownPercent": max_dd,
            "ddDurationDays": int(get_stat("Max Drawdown Duration", 0.0)),
            "totalTrades": int(get_stat("Total Trades")),
            "winningTrades": int(get_stat("Total Trades") * get_stat("Win Rate [%]") / 100.0) if get_stat("Total Trades") > 0 else 0,
            "losingTrades": int(get_stat("Total Trades") - (get_stat("Total Trades") * get_stat("Win Rate [%]") / 100.0)) if get_stat("Total Trades") > 0 else 0,
            "winRate": get_stat("Win Rate [%]"),
            "profitFactor": get_stat("Profit Factor", 1.0),
            "expectancy": get_stat("Expectancy"),
            "sharpeRatio": get_stat("Sharpe Ratio"),
            "sortino_ratio": get_stat("Sortino Ratio"),
            "calmar_ratio": get_stat("Calmar Ratio"),
            "omega_ratio": get_stat("Omega Ratio"),
            "largestWin": get_stat("Best Trade [%]"),
            "largestLoss": get_stat("Worst Trade [%]"),
            "avgWin": get_stat("Avg Winning Trade [%]"),
            "avgLoss": get_stat("Avg Losing Trade [%]"),
            "trades": trades_list,
            "equityCurve": equity_curve,
            "drawdownCurve": drawdown_curve,
            "returns_distribution": daily_returns,
            "ohlcv": ohlcv,
            "indicators": indicators_overlay,
            "tradeMarkers": trade_markers,
            
            # Rich performance & risk metrics for UI parity
            "totalPnl": total_pnl,
            "avgPnl": avg_pnl,
            "avgPnlPercent": avg_pnl_percent,
            "medianPnl": median_pnl,
            "ddStart": start_date,
            "ddEnd": end_date,
            "ddRecovery": "N/A",
            "ddDurationBars": 0,
            "returnToDrawdown": return_to_dd,
            "winningStreak": 0,
            "losingStreak": 0
        }
        return sanitize_floats(result_dict)
