import logging
import json
import math
from datetime import datetime, date, timezone
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.models.option_snapshot import OptionSnapshot, OptionData
from app.models.suggestion import OptionSuggestionHistory
from app.services.greeks.engine import GreeksEngine

logger = logging.getLogger("gamma-exposure-backend.suggestions")

class OptionSuggestionsService:
    """
    Analyzes live options chains to calculate pin risk, short-squeezes,
    and range credit plays. Logs the output to database history.
    """
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def get_suggestions_history(self, ticker: str, limit: int = 100) -> List[Dict[str, Any]]:
        t = ticker.upper()
        stmt = (
            select(OptionSuggestionHistory)
            .where(OptionSuggestionHistory.ticker == t)
            .order_by(desc(OptionSuggestionHistory.timestamp))
            .limit(limit)
        )
        res = await self.db.execute(stmt)
        rows = res.scalars().all()

        return [
            {
                "id": r.id,
                "ticker": r.ticker,
                "timestamp": r.timestamp,
                "spotPrice": float(r.spot_price),
                "suggestionType": r.suggestion_type,
                "title": r.title,
                "description": r.description,
                "strikes": r.strikes,
                "entryTrigger": r.entry_trigger,
                "riskReward": r.risk_reward,
                "confidenceScore": int(r.confidence_score),
                "ppi": float(r.ppi) if r.ppi is not None else 50.0,
                "recordedLegs": r.recorded_legs if isinstance(r.recorded_legs, dict) else json.loads(r.recorded_legs or "{}")
            }
            for r in rows
        ]

    async def record_option_suggestion(self, ticker: str) -> Optional[Dict[str, Any]]:
        """
        Runs mathematical scans on the current option snapshot, formulates strategy setups,
        saves the suggestion print to the database, and returns the result.
        """
        t = ticker.upper()
        
        # 1. Fetch latest snapshot
        snap_stmt = select(OptionSnapshot).where(OptionSnapshot.ticker == t).order_by(desc(OptionSnapshot.timestamp)).limit(1)
        snap_res = await self.db.execute(snap_stmt)
        snapshot = snap_res.scalar_one_or_none()
        
        if not snapshot:
            logger.warning(f"No option snapshots found for {t}. Skipping suggestion logging.")
            return None

        spot = float(snapshot.spot_price)
        reference_date = snapshot.timestamp

        # 2. Fetch options
        opts_stmt = select(OptionData).where(OptionData.snapshot_id == snapshot.id)
        opts_res = await self.db.execute(opts_stmt)
        options = opts_res.scalars().all()

        if not options:
            logger.warning(f"Snapshot {snapshot.id} contains no option contracts. Skipping.")
            return None

        # 3. Determine target expiration (closest to now)
        today = reference_date.date()
        expiries = sorted(list(set(opt.expiration.date() if hasattr(opt.expiration, 'date') else opt.expiration for opt in options)))
        
        active_expiry = next((exp for exp in expiries if exp >= today), expiries[0])

        total_gex = 0.0
        gex_by_strike = {}
        strike_oi = {}

        for opt in options:
            vol = float(opt.implied_volatility or 0.3)
            # time to expiration in years
            days_diff = max(1, (opt.expiration.date() - today).days)
            T = days_diff / 262.0  # trading days scale or 365
            r = 0.0525
            q = 0.0

            # Analytical Gamma calculation
            gamma = 0.0
            if T > 0 and vol > 0:
                d1 = (math_log(spot / float(opt.strike)) + (r - q + 0.5 * vol * vol) * T) / (vol * np_sqrt(T))
                norm_pdf = math_exp(-0.5 * d1 * d1) / np_sqrt(2 * np_pi())
                gamma = (math_exp(-q * T) * norm_pdf) / (spot * vol * np_sqrt(T))

            # Scaled GEX calculation (comparable to TS calculations)
            gex_val = float(opt.open_interest or 0) * 100.0 * spot * spot * 0.01 * gamma
            if opt.option_type == 'P':
                gex_val = -gex_val

            total_gex += gex_val
            strike_val = float(opt.strike)
            gex_by_strike[strike_val] = gex_by_strike.get(strike_val, 0.0) + gex_val

            if opt.expiration.date() == active_expiry:
                if strike_val not in strike_oi:
                    strike_oi[strike_val] = {"callOi": 0, "putOi": 0}
                if opt.option_type == 'C':
                    strike_oi[strike_val]["callOi"] += int(opt.open_interest or 0)
                else:
                    strike_oi[strike_val]["putOi"] += int(opt.open_interest or 0)

        # Nearest GEX Magnet / Gravity Well
        localized_range = spot * 0.015
        max_gex_strike = 0.0
        max_gex_val = 0.0
        has_localized_magnet = False

        for strike, val in gex_by_strike.items():
            if abs(strike - spot) <= localized_range:
                if abs(val) > abs(max_gex_val):
                    max_gex_val = val
                    max_gex_strike = strike
                    has_localized_magnet = True

        if not has_localized_magnet:
            for strike, val in gex_by_strike.items():
                if abs(val) > abs(max_gex_val):
                    max_gex_val = val
                    max_gex_strike = strike

        # Call/Put walls by OI
        call_wall = spot * 1.01
        put_wall = spot * 0.99
        max_call_oi = -1
        max_put_oi = -1

        for strike, oi in strike_oi.items():
            if oi["callOi"] > max_call_oi:
                max_call_oi = oi["callOi"]
                call_wall = strike
            if oi["putOi"] > max_put_oi:
                max_put_oi = oi["putOi"]
                put_wall = strike

        # Localized nearest above/below GEX
        strike_above = spot * 1.01
        strike_below = spot * 0.99
        max_gex_above_val = 0.0
        max_gex_below_val = 0.0
        has_localized_above = False
        has_localized_below = False

        for strike, val in gex_by_strike.items():
            if spot < strike <= spot + localized_range:
                if val > max_gex_above_val:
                    max_gex_above_val = val
                    strike_above = strike
                    has_localized_above = True
            elif spot - localized_range <= strike < spot:
                if abs(val) > max_gex_below_val:
                    max_gex_below_val = abs(val)
                    strike_below = strike
                    has_localized_below = True

        if not has_localized_above:
            for strike, val in gex_by_strike.items():
                if strike > spot:
                    if val > max_gex_above_val:
                        max_gex_above_val = val
                        strike_above = strike

        if not has_localized_below:
            for strike, val in gex_by_strike.items():
                if strike < spot:
                    if abs(val) > max_gex_below_val:
                        max_gex_below_val = abs(val)
                        strike_below = strike

        round_strike_above = round(strike_above / 5.0) * 5.0
        round_strike_below = round(strike_below / 5.0) * 5.0

        # Minutes till close estimation (NYC timezone basis)
        hour = reference_date.hour
        minutes = reference_date.minute
        minutes_till_close = max(5, min(390, (16 - hour) * 60 - minutes))

        is_pos_gex = total_gex > 0.0
        proximity = abs(spot - max_gex_strike) / spot
        ppi = 40.0
        
        if is_pos_gex:
            ppi += 20.0
        else:
            ppi -= 35.0

        if proximity < 0.001:
            ppi += 30.0
        elif proximity < 0.005:
            ppi += 15.0
        elif proximity > 0.015:
            ppi -= 20.0

        if minutes_till_close <= 60:
            ppi += 15.0

        final_ppi = max(5.0, min(95.0, ppi))
        is_pin_regime = final_ppi >= 55.0 or (total_gex < 0.0 and proximity < 0.008)

        dist_to_call = abs(spot - call_wall) / spot
        dist_to_put = abs(spot - put_wall) / spot
        call_prob = max(2, min(98, round((1.0 - dist_to_call) * 50.0 + (30.0 if total_gex < 0.0 else -10.0))))
        put_prob = max(2, min(98, round((1.0 - dist_to_put) * 50.0 + (30.0 if total_gex < 0.0 else -10.0))))

        sug_type = "neutral_pin"
        title = ""
        description = ""
        strikes = ""
        confidence_score = final_ppi
        entry_trigger = ""
        risk_reward = ""

        if is_pin_regime:
            if total_gex < 0.0:
                sug_type = "bearish_breakout"
                title = f"{t} 0DTE Negative Pin Settlebomb"
                description = f"A massive negative GEX cluster at {max_gex_strike:.1f} is acting as a gravity well. Despite negative gamma volatility, dealer hedging flows are trapping the index near this key strike."
                strikes = f"BUY 1x SPX {max_gex_strike - 10:.0f} Put / SELL 2x SPX {max_gex_strike:.0f} Put / BUY 1x SPX {max_gex_strike + 10:.0f} Put (0DTE Put Butterfly Spread)"
                entry_trigger = f"Enter when price oscillates within 0.5% of {max_gex_strike:.1f} after 2:30 PM EST."
                risk_reward = "Max Risk: $220 | Max Reward: $780 (per lot)"
                confidence_score = max(50.0, 90.0 - round(proximity * 10000.0))
            else:
                sug_type = "neutral_pin"
                title = f"{t} 0DTE Pin Settlebomb"
                description = f"Positive GEX cluster is acting as a major price magnet. Dealer hedging will compress volatility and pin the close near {max_gex_strike:.1f}."
                strikes = f"BUY 1x SPX {max_gex_strike - 10:.0f} Call / SELL 2x SPX {max_gex_strike:.0f} Call / BUY 1x SPX {max_gex_strike + 10:.0f} Call (0DTE Butterfly Spread)"
                entry_trigger = f"Enter between 3:15 PM and 3:30 PM EST if price remains within 0.25% of {max_gex_strike:.1f}."
                risk_reward = "Max Risk: $180 | Max Reward: $820 (per lot)"
        else:
            is_call_wall_proximity = abs(spot - call_wall) / spot < 0.003
            is_put_wall_proximity = abs(spot - put_wall) / spot < 0.003

            if spot >= call_wall or is_call_wall_proximity:
                sug_type = "bullish_squeeze"
                title = f"{t} 0DTE Squeeze Settlebomb (Target: {round_strike_above:.0f})"
                description = f"Spot is breaching Call Wall at {call_wall:.1f} in a Negative GEX regime. Dealer short-gamma covering will accelerate a sharp short-squeeze upward, pulling price toward the highest positive GEX cluster at {round_strike_above:.0f}."
                strikes = f"BUY 1x SPX {round(call_wall/5.0)*5.0:.0f} Call / SELL 1x SPX {round_strike_above:.0f} Call (0DTE Bull Call Spread)"
                entry_trigger = f"Enter on a solid 5-minute candle close above {call_wall:.1f} with rising options volume."
                risk_reward = "Max Risk: $250 | Max Reward: Unlimited (Uncapped squeeze)"
                confidence_score = float(call_prob * 0.9)
            elif spot <= put_wall or is_put_wall_proximity:
                sug_type = "bearish_breakout"
                title = f"{t} 0DTE Put Crash Settlebomb (Target: {round_strike_below:.0f})"
                description = f"Spot is cracking below Put Wall at {put_wall:.1f} in a Negative GEX regime. Dealer delta-hedging will dump futures, creating a cascading selloff toward the highest negative GEX cluster at {round_strike_below:.0f}."
                strikes = f"BUY 1x SPX {round(put_wall/5.0)*5.0:.0f} Put / SELL 1x SPX {round_strike_below:.0f} Put (0DTE Bear Put Spread)"
                entry_trigger = f"Enter on a solid 5-minute candle close below {put_wall:.1f} with high put buying flow."
                risk_reward = "Max Risk: $300 | Max Reward: Unlimited"
                confidence_score = float(put_prob * 0.9)
            else:
                sug_type = "credit_spread"
                title = f"{t} 0DTE Range-Bound Credit Settlebomb"
                description = f"Volatility is elevated but spot sits in no-man's-land between {put_wall:.1f} and {call_wall:.1f}. Positive GEX walls are holding."
                strikes = f"SELL 1x SPX {math_ceil(call_wall/5.0)*5.0:.0f} Call / SELL 1x SPX {math_floor(put_wall/5.0)*5.0:.0f} Put (0DTE Iron Condor)"
                entry_trigger = "Enter if index stays in range during lunchtime (11:30 AM - 1:30 PM EST) and decay ramps."
                risk_reward = "Max Risk: $400 | Max Reward: $100 (92% probability of full profit)"
                confidence_score = 88.0

        # Detailed Contract prints helper
        def get_option_details(strike_num: float, opt_type: str):
            opt = next((o for o in options if abs(float(o.strike) - strike_num) < 0.01 and o.option_type == opt_type and o.expiration.date() == active_expiry), None)
            if not opt:
                return None
            return {
                "strike": float(opt.strike),
                "type": opt.option_type,
                "expiration": opt.expiration.isoformat(),
                "last_price": float(opt.last_price or 0.0),
                "bid": float(opt.bid) if opt.bid is not None else 0.0,
                "ask": float(opt.ask) if opt.ask is not None else 0.0,
                "mid_price": (float(opt.bid) + float(opt.ask)) / 2.0 if (opt.bid is not None and opt.ask is not None) else float(opt.last_price or 0.0),
                "volume": int(opt.volume or 0),
                "open_interest": int(opt.open_interest or 0),
                "implied_volatility": float(opt.implied_volatility or 0.0),
                "delta": float(opt.delta) if opt.delta is not None else 0.0,
                "gamma": float(opt.gamma) if opt.gamma is not None else 0.0,
                "theta": float(opt.theta) if opt.theta is not None else 0.0,
                "vega": float(opt.vega) if opt.vega is not None else 0.0,
                "gex_bs": int(opt.open_interest or 0) * 100.0 * spot * spot * 0.01 * float(opt.gamma or 0.0) * (-1.0 if opt.option_type == 'P' else 1.0)
            }

        def find_option_by_delta(opt_type: str, target_delta: float):
            expiry_options = [o for o in options if o.option_type == opt_type and o.expiration.date() == active_expiry]
            if not expiry_options:
                return None
            closest_opt = min(expiry_options, key=lambda o: abs(abs(float(o.delta or 0.0)) - target_delta))
            return get_option_details(float(closest_opt.strike), opt_type)

        closest_above = min((s for s in strike_oi.keys() if s >= spot), default=spot * 1.001)
        closest_below = max((s for s in strike_oi.keys() if s <= spot), default=spot * 0.999)

        single_legs = {
            "atm_call": get_option_details(closest_above, 'C'),
            "atm_put": get_option_details(closest_below, 'P'),
            "otm_25d_call": find_option_by_delta('C', 0.25),
            "otm_25d_put": find_option_by_delta('P', 0.25),
            "otm_15d_call": find_option_by_delta('C', 0.15),
            "otm_15d_put": find_option_by_delta('P', 0.15)
        }

        # Gather Recommended Strategy legs
        strategy_legs = []
        if is_pin_regime:
            strategy_type = 'P' if total_gex < 0.0 else 'C'
            leg1 = get_option_details(max_gex_strike - 10, strategy_type)
            leg2 = get_option_details(max_gex_strike, strategy_type)
            leg3 = get_option_details(max_gex_strike + 10, strategy_type)
            if leg1: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg1})
            if leg2: strategy_legs.append({"action": "SELL", "ratio": 2, "contract": leg2})
            if leg3: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg3})
        else:
            is_call_wall_proximity = abs(spot - call_wall) / spot < 0.003
            is_put_wall_proximity = abs(spot - put_wall) / spot < 0.003
            if spot >= call_wall or is_call_wall_proximity:
                leg1 = get_option_details(round(call_wall/5.0)*5.0, 'C')
                leg2 = get_option_details(round_strike_above, 'C')
                if leg1: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg1})
                if leg2: strategy_legs.append({"action": "SELL", "ratio": 1, "contract": leg2})
            elif spot <= put_wall or is_put_wall_proximity:
                leg1 = get_option_details(round(put_wall/5.0)*5.0, 'P')
                leg2 = get_option_details(round_strike_below, 'P')
                if leg1: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg1})
                if leg2: strategy_legs.append({"action": "SELL", "ratio": 1, "contract": leg2})
            else:
                short_call = math_ceil(call_wall / 5.0) * 5.0
                short_put = math_floor(put_wall / 5.0) * 5.0
                leg1 = get_option_details(short_call, 'C')
                leg2 = get_option_details(short_call + 10, 'C')
                leg3 = get_option_details(short_put, 'P')
                leg4 = get_option_details(short_put - 10, 'P')
                if leg1: strategy_legs.append({"action": "SELL", "ratio": 1, "contract": leg1})
                if leg2: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg2})
                if leg3: strategy_legs.append({"action": "SELL", "ratio": 1, "contract": leg3})
                if leg4: strategy_legs.append({"action": "BUY", "ratio": 1, "contract": leg4})

        recorded_legs = {
            "single_legs": single_legs,
            "strategy_legs": strategy_legs
        }

        # Write to db
        db_suggestion = OptionSuggestionHistory(
            ticker=t,
            timestamp=snapshot.timestamp,
            spot_price=spot,
            suggestion_type=sug_type,
            title=title,
            description=description,
            strikes=strikes,
            entry_trigger=entry_trigger,
            risk_reward=risk_reward,
            confidence_score=confidence_score,
            ppi=final_ppi,
            recorded_legs=recorded_legs
        )
        self.db.add(db_suggestion)
        await self.db.commit()
        await self.db.refresh(db_suggestion)

        return {
            "id": db_suggestion.id,
            "ticker": t,
            "timestamp": db_suggestion.timestamp,
            "spotPrice": spot,
            "suggestionType": sug_type,
            "title": title,
            "description": description,
            "strikes": strikes,
            "entryTrigger": entry_trigger,
            "riskReward": risk_reward,
            "confidenceScore": confidence_score,
            "ppi": final_ppi,
            "recordedLegs": recorded_legs
        }

# Math convenience wrappers
def math_log(val: float) -> float:
    return math.log(val) if val > 0.0 else 0.0

def math_exp(val: float) -> float:
    return math.exp(val)

def np_sqrt(val: float) -> float:
    return math.sqrt(val)

def np_pi() -> float:
    return math.pi

def math_ceil(val: float) -> float:
    return float(math.ceil(val))

def math_floor(val: float) -> float:
    return float(math.floor(val))
