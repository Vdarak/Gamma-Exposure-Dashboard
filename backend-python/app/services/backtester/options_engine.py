import json
import logging
from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, update
from decimal import Decimal
import numpy as np

from app.models.quant import SpotPriceHistory, DailyOptionSummary
from app.models.option_snapshot import OptionSnapshot, OptionData
from app.models.suggestion import OptionSuggestionHistory
from app.services.backtester.engine import sanitize_floats

logger = logging.getLogger("gamma-exposure-backend.backtester.options_engine")

async def get_option_price_at_snapshot(
    db: AsyncSession, snapshot_id: int, strike: float, type_char: str, expiration: date
) -> Optional[float]:
    """Retrieves option mid price (or last price) at a given snapshot."""
    query = """
        SELECT bid, ask, last_price
        FROM option_data
        WHERE snapshot_id = :snapshot_id AND strike = :strike AND option_type = :type_char
        LIMIT 1
    """
    res = await db.execute(text(query), {
        "snapshot_id": snapshot_id,
        "strike": strike,
        "type_char": type_char
    })
    row = res.fetchone()
    if not row:
        return None
        
    bid, ask, last = row
    if bid is not None and ask is not None:
        return float((bid + ask) / 2)
    if last is not None:
        return float(last)
    return 0.0

async def reconstruct_suggestion_legs(
    db: AsyncSession, suggestion_id: int, ticker: str, entry_time: datetime, spot: float
) -> Optional[Dict[str, Any]]:
    """Reconstructs single and strategy legs for a historical option suggestion snapshot."""
    try:
        # 1. Find closest snapshot
        snap_query = """
            SELECT id, spot_price
            FROM option_snapshots
            WHERE ticker = :ticker AND ABS(EXTRACT(EPOCH FROM (timestamp - :entry_time))) < 90
            ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - :entry_time))) ASC
            LIMIT 1
        """
        snap_res = await db.execute(text(snap_query), {
            "ticker": ticker,
            "entry_time": entry_time
        })
        snap_row = snap_res.fetchone()
        if not snap_row:
            return None
            
        snapshot_id, snap_spot = snap_row
        snap_spot = float(snap_spot)

        # 2. Fetch options
        opt_query = """
            SELECT strike, option_type, expiration, last_price, bid, ask, volume, open_interest, implied_volatility, delta, gamma, theta, vega
            FROM option_data
            WHERE snapshot_id = :snapshot_id
        """
        opt_res = await db.execute(text(opt_query), {"snapshot_id": snapshot_id})
        option_rows = opt_res.fetchall()
        if not option_rows:
            return None

        options = []
        for r in option_rows:
            # parse expiration
            exp_date = r[2]
            if isinstance(exp_date, str):
                exp_date = datetime.strptime(exp_date.split("T")[0], "%Y-%m-%d").date()
                
            options.append({
                "strike": float(r[0]),
                "type": r[1],
                "expiration": exp_date,
                "last_price": float(r[3] or 0.0),
                "bid": float(r[4] or 0.0),
                "ask": float(r[5] or 0.0),
                "volume": int(r[6] or 0),
                "open_interest": int(r[7] or 0),
                "implied_volatility": float(r[8] or 0.3),
                "delta": float(r[9] or 0.0),
                "gamma": float(r[10] or 0.0),
                "theta": float(r[11] or 0.0),
                "vega": float(r[12] or 0.0)
            })

        # Find expiry dates
        expiries = sorted(list(set(o["expiration"] for o in options)))
        ref_date = entry_time.date()
        selected_expiry = next((d for d in expiries if d >= ref_date), expiries[0] if expiries else ref_date)

        # Walls and pinning calculations
        total_gex = 0.0
        gex_by_strike = {}
        
        # Simple GEX and Walls estimation matching legacy
        max_call_oi = 0
        call_wall = snap_spot
        max_put_oi = 0
        put_wall = snap_spot
        
        for opt in options:
            vol = opt["implied_volatility"]
            days_diff = max(1, (opt["expiration"] - ref_date).days)
            T = days_diff / 262.0
            r = 0.0525
            q = 0.0
            
            gamma_val = opt["gamma"]
            if gamma_val == 0.0 and T > 0 and vol > 0:
                # Black-Scholes gamma proxy
                d1 = (np.log(snap_spot / opt["strike"]) + (r - q + 0.5 * vol * vol) * T) / (vol * np.sqrt(T))
                norm_pdf = np.exp(-0.5 * d1 * d1) / np.sqrt(2 * np.pi)
                gamma_val = (np.exp(-q * T) * norm_pdf) / (snap_spot * vol * np.sqrt(T))

            gex_val = opt["open_interest"] * 100 * snap_spot * snap_spot * 0.01 * gamma_val
            if opt["type"] == "P":
                gex_val = -gex_val
                if opt["expiration"] == selected_expiry and opt["open_interest"] > max_put_oi:
                    max_put_oi = opt["open_interest"]
                    put_wall = opt["strike"]
            else:
                if opt["expiration"] == selected_expiry and opt["open_interest"] > max_call_oi:
                    max_call_oi = opt["open_interest"]
                    call_wall = opt["strike"]

            total_gex += gex_val
            gex_by_strike[opt["strike"]] = gex_by_strike.get(opt["strike"], 0.0) + gex_val

        # Max GEX strike
        max_gex_strike = snap_spot
        if gex_by_strike:
            max_gex_strike = max(gex_by_strike.keys(), key=lambda k: abs(gex_by_strike[k]))

        # Proximity and pinning regime
        proximity = abs(snap_spot - max_gex_strike) / snap_spot
        ppi = 40
        if total_gex > 0:
            ppi += 20
        else:
            ppi -= 35
        if proximity < 0.001:
            ppi += 30
        elif proximity < 0.005:
            ppi += 15
        elif proximity > 0.015:
            ppi -= 20
        final_ppi = max(5, min(95, ppi))
        is_pin_regime = final_ppi >= 55 or (total_gex < 0 and proximity < 0.008)

        # Helpers
        def get_option_details(strike_num: float, opt_type: str) -> Optional[dict]:
            opt = next((o for o in options if abs(o["strike"] - strike_num) < 0.01 and o["type"] == opt_type and o["expiration"] == selected_expiry), None)
            if not opt:
                return None
            return {
                "strike": opt["strike"],
                "type": opt["type"],
                "expiration": opt["expiration"].isoformat(),
                "last_price": opt["last_price"],
                "bid": opt["bid"],
                "ask": opt["ask"],
                "mid_price": (opt["bid"] + opt["ask"]) / 2 if opt["bid"] > 0 and opt["ask"] > 0 else opt["last_price"],
                "volume": opt["volume"],
                "open_interest": opt["open_interest"],
                "implied_volatility": opt["implied_volatility"],
                "delta": opt["delta"],
                "gamma": opt["gamma"],
                "theta": opt["theta"],
                "vega": opt["vega"]
            }

        def find_option_by_delta(opt_type: str, target_delta: float) -> Optional[dict]:
            expiry_options = [o for o in options if o["type"] == opt_type and o["expiration"] == selected_expiry]
            if not expiry_options:
                return None
            closest = min(expiry_options, key=lambda o: abs(abs(o["delta"]) - target_delta))
            return get_option_details(closest["strike"], opt_type)

        sorted_strikes = sorted(list(set(o["strike"] for o in options)))
        closest_above = next((s for s in sorted_strikes if s >= snap_spot), snap_spot * 1.001)
        closest_below = next((s for s in reversed(sorted_strikes) if s <= snap_spot), snap_spot * 0.999)

        single_legs = {
            "atm_call": get_option_details(closest_above, "C"),
            "atm_put": get_option_details(closest_below, "P"),
            "otm_25d_call": find_option_by_delta("C", 0.25),
            "otm_25d_put": find_option_by_delta("P", 0.25),
            "otm_15d_call": find_option_by_delta("C", 0.15),
            "otm_15d_put": find_option_by_delta("P", 0.15),
        }

        # Build strategy legs
        strategy_legs = []
        if is_pin_regime:
            opt_type = "P" if total_gex < 0 else "C"
            leg1 = get_option_details(max_gex_strike - 10, opt_type)
            leg2 = get_option_details(max_gex_strike, opt_type)
            leg3 = get_option_details(max_gex_strike + 10, opt_type)
            if leg1: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg1})
            if leg2: strategy_legs.append({"action": "SELL", "ratio": 2, "contract": leg2})
            if leg3: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg3})
        else:
            is_call_wall_prox = abs(snap_spot - call_wall) / snap_spot < 0.003
            is_put_wall_prox = abs(snap_spot - put_wall) / snap_spot < 0.003
            
            if snap_spot >= call_wall or is_call_wall_prox:
                buy_strike = round(call_wall / 5) * 5
                sell_strike = round((call_wall + 10) / 5) * 5
                leg1 = get_option_details(buy_strike, "C")
                leg2 = get_option_details(sell_strike, "C")
                if leg1: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg1})
                if leg2: strategy_legs.append({"action": "SELL", "ratio": 1, "contract": leg2})
            elif snap_spot <= put_wall or is_put_wall_prox:
                buy_strike = round(put_wall / 5) * 5
                sell_strike = round((put_wall - 10) / 5) * 5
                leg1 = get_option_details(buy_strike, "P")
                leg2 = get_option_details(sell_strike, "P")
                if leg1: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg1})
                if leg2: strategy_legs.append({"action": "SELL", "ratio": 1, "contract": leg2})
            else:
                short_call = round(call_wall / 5) * 5
                long_call = short_call + 10
                short_put = round(put_wall / 5) * 5
                long_put = short_put - 10
                leg1_s_c = get_option_details(short_call, "C")
                leg1_l_c = get_option_details(long_call, "C")
                leg2_s_p = get_option_details(short_put, "P")
                leg2_l_p = get_option_details(long_put, "P")
                if leg1_s_c: strategy_legs.append({"action": "SELL", "ratio": 1, "contract": leg1_s_c})
                if leg1_l_c: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg1_l_c})
                if leg2_s_p: strategy_legs.append({"action": "SELL", "ratio": 1, "contract": leg2_s_p})
                if leg2_l_p: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg2_l_p})

        reconstructed = {
            "single_legs": single_legs,
            "strategy_legs": strategy_legs
        }

        # Update table
        stmt = update(OptionSuggestionHistory).where(OptionSuggestionHistory.id == suggestion_id).values(
            recorded_legs=json.dumps(reconstructed)
        )
        await db.execute(stmt)
        await db.commit()
        return reconstructed

    except Exception as e:
        logger.error(f"Error reconstructing suggestion legs for ID {suggestion_id}: {e}", exc_info=True)
        return None

async def run_options_backtest(db: AsyncSession, config: dict) -> dict:
    """Simulates 0DTE Options backtesting using historical snapshots and suggestions."""
    ticker = config.get("ticker", "SPX")
    start_date = config.get("startDate", "2026-01-01")
    end_date = config.get("endDate", "2026-12-31")
    initial_capital = float(config.get("initialCapital", 10000.0))
    tp_limit = float(config.get("takeProfitPercent", 50.0))
    sl_limit = float(config.get("stopLossPercent", 50.0))
    strat_class = config.get("strategyClass", "multileg")

    logger.info(f"Running options backtest: Ticker={ticker}, Class={strat_class}")

    # Convert start_date and end_date strings to datetimes for strict SQL typing
    from datetime import datetime, time
    start_dt = datetime.combine(datetime.strptime(start_date.split("T")[0], "%Y-%m-%d").date(), time.min)
    end_dt = datetime.combine(datetime.strptime(end_date.split("T")[0], "%Y-%m-%d").date(), time.max)

    # Fetch suggestions
    stmt = select(
        OptionSuggestionHistory.id,
        OptionSuggestionHistory.timestamp,
        OptionSuggestionHistory.spot_price,
        OptionSuggestionHistory.recorded_legs
    ).where(
        OptionSuggestionHistory.ticker == ticker,
        OptionSuggestionHistory.timestamp >= start_dt,
        OptionSuggestionHistory.timestamp <= end_dt
    ).order_by(OptionSuggestionHistory.timestamp.asc())

    res = await db.execute(stmt)
    rows = res.fetchall()

    trades = []
    cash = initial_capital
    equity_curve = []
    lot_multiplier = 100

    for row in rows:
        suggestion_id, entry_time, entry_spot, recorded_legs = row
        entry_spot = float(entry_spot)

        # Parse recorded legs
        legs_data = None
        if recorded_legs:
            if isinstance(recorded_legs, str):
                try:
                    legs_data = json.loads(recorded_legs)
                except Exception:
                    pass
            else:
                legs_data = recorded_legs
                
        if not legs_data:
            legs_data = await reconstruct_suggestion_legs(db, suggestion_id, ticker, entry_time, entry_spot)

        if not legs_data:
            continue

        legs_to_trade = []
        if strat_class == "multileg":
            s_legs = legs_data.get("strategy_legs", [])
            for leg in s_legs:
                c = leg.get("contract") or leg
                if c:
                    # extract expiration date
                    exp_date = c.get("expiration")
                    if isinstance(exp_date, str):
                        exp_date = datetime.strptime(exp_date.split("T")[0], "%Y-%m-%d").date()
                        
                    legs_to_trade.append({
                        "action": leg.get("action", "BUY"),
                        "strike": float(c["strike"]),
                        "type": c["type"],
                        "expiration": exp_date,
                        "entryPrice": float(c.get("mid_price") or (float(c.get("bid", 0)) + float(c.get("ask", 0))) / 2 or float(c.get("last_price", 0))),
                        "ratio": int(leg.get("ratio", 1))
                    })
        else:
            s_legs = legs_data.get("single_legs", {})
            target = s_legs.get(strat_class)
            if target:
                exp_date = target.get("expiration")
                if isinstance(exp_date, str):
                    exp_date = datetime.strptime(exp_date.split("T")[0], "%Y-%m-%d").date()
                    
                legs_to_trade.append({
                    "action": "BUY",
                    "strike": float(target["strike"]),
                    "type": target["type"],
                    "expiration": exp_date,
                    "entryPrice": float(target.get("mid_price") or (float(target.get("bid", 0)) + float(target.get("ask", 0))) / 2 or float(target.get("last_price", 0))),
                    "ratio": 1
                })

        if not legs_to_trade:
            continue

        # Net entry premium V0
        V0 = 0.0
        for leg in legs_to_trade:
            sign = 1.0 if leg["action"] == "BUY" else -1.0
            V0 += leg["ratio"] * sign * leg["entryPrice"]

        if abs(V0) == 0.0:
            continue

        # Query subsequent snapshots on that day
        # e.g. same day date logic
        day_start = datetime.combine(entry_time.date(), datetime.min.time())
        day_end = datetime.combine(entry_time.date(), datetime.max.time())
        
        snap_stmt = """
            SELECT id, timestamp, spot_price
            FROM option_snapshots
            WHERE ticker = :ticker AND timestamp >= :day_start AND timestamp <= :day_end AND timestamp > :entry_time
            ORDER BY timestamp ASC
        """
        snap_res = await db.execute(text(snap_stmt), {
            "ticker": ticker,
            "day_start": day_start,
            "day_end": day_end,
            "entry_time": entry_time
        })
        next_snaps = snap_res.fetchall()

        exited = False
        exit_price = V0
        exit_time = entry_time
        exit_reason = "time_based"
        last_spot = entry_spot

        for snap in next_snaps:
            snap_id, snap_time, snap_spot = snap
            snap_spot = float(snap_spot)
            last_spot = snap_spot

            Vt = 0.0
            for leg in legs_to_trade:
                price = await get_option_price_at_snapshot(db, snap_id, leg["strike"], leg["type"], leg["expiration"])
                sign = 1.0 if leg["action"] == "BUY" else -1.0
                if price is not None:
                    Vt += leg["ratio"] * sign * price
                else:
                    # intrinsic value fallback
                    intrinsic = max(0.0, snap_spot - leg["strike"]) if leg["type"] == "C" else max(0.0, leg["strike"] - snap_spot)
                    Vt += leg["ratio"] * sign * intrinsic

            pnl = Vt - V0
            hit_stop = False
            hit_target = False

            if V0 > 0:
                # Debit / Long
                hit_stop = Vt <= V0 * (1 - sl_limit / 100.0)
                hit_target = Vt >= V0 * (1 + tp_limit / 100.0)
            else:
                # Credit / Short
                credit = -V0
                hit_stop = pnl <= -credit * (sl_limit / 100.0)
                hit_target = pnl >= credit * (tp_limit / 100.0)

            if hit_stop or hit_target:
                exit_price = Vt
                exit_time = snap_time
                exit_reason = "stop_loss" if hit_stop else "take_profit"
                exited = True
                break

        # End of day force close
        if not exited and next_snaps:
            last_snap_id, last_snap_time, last_snap_spot = next_snaps[-1]
            last_snap_spot = float(last_snap_spot)
            exit_time = last_snap_time
            last_spot = last_snap_spot

            Vt = 0.0
            for leg in legs_to_trade:
                price = await get_option_price_at_snapshot(db, last_snap_id, leg["strike"], leg["type"], leg["expiration"])
                sign = 1.0 if leg["action"] == "BUY" else -1.0
                if price is not None:
                    Vt += leg["ratio"] * sign * price
                else:
                    intrinsic = max(0.0, last_snap_spot - leg["strike"]) if leg["type"] == "C" else max(0.0, leg["strike"] - last_snap_spot)
                    Vt += leg["ratio"] * sign * intrinsic
            exit_price = Vt
            exit_reason = "time_based"

        # Trade metrics
        pnl_points = exit_price - V0
        trade_pnl = pnl_points * lot_multiplier
        
        risk_basis = V0 if V0 > 0 else (-V0)
        pnl_percent = (pnl_points / risk_basis) * 100.0 if risk_basis > 0 else 0.0

        cash += trade_pnl
        trades.append({
            "id": f"T-{len(trades) + 1}",
            "type": "long" if V0 > 0 else "short",
            "entryDate": entry_time.isoformat(),
            "entryPrice": float(V0),
            "exitDate": exit_time.isoformat(),
            "exitPrice": float(exit_price),
            "quantity": lot_multiplier,
            "pnl": float(trade_pnl),
            "pnlPercent": float(pnl_percent),
            "exitReason": exit_reason
        })

        equity_curve.append({
            "timestamp": exit_time.isoformat(),
            "portfolioValue": float(cash),
            "price": float(last_spot)
        })

    # Summary calculations
    total_trades = len(trades)
    winning_trades = len([t for t in trades if t["pnl"] > 0])
    losing_trades = total_trades - winning_trades
    win_rate = (winning_trades / total_trades) * 100.0 if total_trades > 0 else 0.0

    total_profits = sum(t["pnl"] for t in trades if t["pnl"] > 0)
    total_losses = abs(sum(t["pnl"] for t in trades if t["pnl"] < 0))
    profit_factor = total_profits / total_losses if total_losses > 0 else (999.0 if total_trades > 0 else 0.0)

    total_pnl = cash - initial_capital
    avg_pnl = total_pnl / total_trades if total_trades > 0 else 0.0
    avg_pnl_percent = sum(t["pnlPercent"] for t in trades) / total_trades if total_trades > 0 else 0.0

    max_drawdown = 0.0
    peak = initial_capital
    for eq in equity_curve:
        val = eq["portfolioValue"]
        if val > peak:
            peak = val
        dd = ((peak - val) / peak) * 100.0
        if dd > max_drawdown:
            max_drawdown = dd

    result_dict = {
        "ticker": ticker,
        "startDate": start_date,
        "endDate": end_date,
        "initialCapital": initial_capital,
        "finalCapital": cash,
        "totalReturnPercent": ((cash - initial_capital) / initial_capital) * 100.0,
        "totalTrades": total_trades,
        "winningTrades": winning_trades,
        "losingTrades": losing_trades,
        "winRate": win_rate,
        "profitFactor": profit_factor,
        "maxDrawdownPercent": max_drawdown,
        "sharpeRatio": (avg_pnl / 100.0) * np.sqrt(252) if total_trades > 1 else 0.0,
        "trades": trades,
        "equityCurve": equity_curve if equity_curve else [{"timestamp": start_date, "portfolioValue": initial_capital, "price": 0.0}],
        
        "totalPnl": total_pnl,
        "avgPnl": avg_pnl,
        "avgPnlPercent": avg_pnl_percent,
        "medianPnl": float(np.median([t["pnl"] for t in trades])) if total_trades > 0 else 0.0,
        "avgWin": total_profits / winning_trades if winning_trades > 0 else 0.0,
        "avgLoss": total_losses / losing_trades if losing_trades > 0 else 0.0,
        "ddStart": start_date,
        "ddEnd": end_date,
        "ddRecovery": "N/A",
        "ddDurationBars": 0,
        "ddDurationDays": 0,
        "returnToDrawdown": ((cash - initial_capital) / initial_capital * 100.0) / max_drawdown if max_drawdown > 0 else 0.0,
        "largestWin": max([t["pnl"] for t in trades]) if total_trades > 0 else 0.0,
        "largestLoss": min([t["pnl"] for t in trades]) if total_trades > 0 else 0.0,
        "expectancy": (win_rate / 100.0) * (total_profits / max(1, winning_trades)) - ((100.0 - win_rate) / 100.0) * (total_losses / max(1, losing_trades)) if total_trades > 0 else 0.0,
        "winningStreak": 0,
        "losingStreak": 0
    }
    return sanitize_floats(result_dict)
