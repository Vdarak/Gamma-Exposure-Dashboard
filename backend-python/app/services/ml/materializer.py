import logging
from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, text
import numpy as np
import pandas as pd
from decimal import Decimal

from app.models.option_snapshot import OptionSnapshot, OptionData
from app.models.quant import SpotPriceHistory
from app.models.ml import MLFeatureSnapshot

logger = logging.getLogger("gamma-exposure-backend.ml.materializer")

class MLFeatureMaterializer:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def compute_snapshot_features(self, snapshot_id: int, mode: str = "0dte") -> Optional[Dict[str, Any]]:
        """
        Computes ML feature vector for a specific option snapshot and EOD spot history.
        """
        try:
            # 1. Fetch snapshot details
            snap_stmt = select(OptionSnapshot).where(OptionSnapshot.id == snapshot_id)
            snap_res = await self.db.execute(snap_stmt)
            snap = snap_res.scalar_one_or_none()
            if not snap:
                logger.error(f"Snapshot ID {snapshot_id} not found.")
                return None

            spot = float(snap.spot_price)
            ticker = snap.ticker
            ts = snap.timestamp

            # 2. Fetch OptionData
            opt_stmt = select(OptionData).where(OptionData.snapshot_id == snapshot_id)
            opt_res = await self.db.execute(opt_stmt)
            options = opt_res.scalars().all()
            if not options:
                logger.warning(f"No option data found for snapshot {snapshot_id}.")
                return None

            # 3. Calculate basic metrics
            total_gex = 0.0
            total_vanna = 0.0
            total_charm = 0.0
            total_call_oi = 0
            total_put_oi = 0
            total_call_vol = 0
            total_put_vol = 0
            
            call_wall = spot
            put_wall = spot
            max_call_oi = 0
            max_put_oi = 0
            
            strikes_gex = {}
            atm_ivs = []
            otm_call_ivs = []
            otm_put_ivs = []
            bid_ask_spreads = []

            for opt in options:
                strike = float(opt.strike)
                gamma = float(opt.gamma or 0.0)
                oi = int(opt.open_interest or 0)
                vol = int(opt.volume or 0)
                iv = float(opt.implied_volatility or 0.0)
                delta = float(opt.delta or 0.0)
                theta = float(opt.theta or 0.0)
                vega = float(opt.vega or 0.0)
                bid = float(opt.bid or 0.0)
                ask = float(opt.ask or 0.0)

                sign = 1.0 if opt.option_type == "C" else -1.0
                gex = sign * spot * spot * gamma * oi / 1e9
                total_gex += gex
                total_vanna += vega * delta
                total_charm += delta * theta
                
                strikes_gex[strike] = strikes_gex.get(strike, 0.0) + gex

                # Bid ask spread
                if bid > 0 and ask > 0:
                    mid = (bid + ask) / 2
                    bid_ask_spreads.append((ask - bid) / mid if mid > 0 else 0.0)

                # Wall Tracking
                if opt.option_type == "C":
                    total_call_oi += oi
                    total_call_vol += vol
                    if oi > max_call_oi:
                        max_call_oi = oi
                        call_wall = strike
                    if abs(strike - spot) / spot < 0.02:
                        atm_ivs.append(iv)
                    elif strike > spot:
                        otm_call_ivs.append(iv)
                else:
                    total_put_oi += oi
                    total_put_vol += vol
                    if oi > max_put_oi:
                        max_put_oi = oi
                        put_wall = strike
                    if abs(strike - spot) / spot < 0.02:
                        atm_ivs.append(iv)
                    elif strike < spot:
                        otm_put_ivs.append(iv)

            # Concentration
            gex_concentration = 0.0
            if strikes_gex:
                top_3_abs = sorted([abs(x) for x in strikes_gex.values()], reverse=True)[:3]
                tot_abs = sum(abs(x) for x in strikes_gex.values())
                gex_concentration = sum(top_3_abs) / tot_abs if tot_abs > 0 else 0.0

            # Gamma flip calculation
            gamma_flip = spot
            near_spot = sorted(list(strikes_gex.keys()), key=lambda x: abs(x - spot))[:10]
            near_spot.sort()
            for i in range(len(near_spot) - 1):
                s1, s2 = near_spot[i], near_spot[i+1]
                g1, g2 = strikes_gex[s1], strikes_gex[s2]
                if (g1 >= 0 and g2 < 0) or (g1 < 0 and g2 >= 0):
                    t = abs(g1) / (abs(g1) + abs(g2)) if (abs(g1) + abs(g2)) > 0 else 0.5
                    gamma_flip = s1 + t * (s2 - s1)
                    break

            # Distances
            call_wall_distance = (call_wall - spot) / spot
            put_wall_distance = (spot - put_wall) / spot
            gamma_flip_distance = (gamma_flip - spot) / spot

            # Put Call ratios
            put_call_oi_ratio = total_put_oi / total_call_oi if total_call_oi > 0 else 1.0
            put_call_volume_ratio = total_put_vol / total_call_vol if total_call_vol > 0 else 1.0
            bullish_sentiment_pct = (total_call_vol / (total_call_vol + total_put_vol) * 100.0) if (total_call_vol + total_put_vol) > 0 else 50.0

            # Vol skew
            avg_call_otm_iv = np.mean(otm_call_ivs) if otm_call_ivs else 0.2
            avg_put_otm_iv = np.mean(otm_put_ivs) if otm_put_ivs else 0.2
            iv_skew_25d = avg_put_otm_iv / avg_call_otm_iv if avg_call_otm_iv > 0 else 1.0
            atm_iv = np.mean(atm_ivs) if atm_ivs else 0.2

            # Historical returns
            # Fetch last 30 minutes / 60 minutes spot prices
            hist_stmt = select(SpotPriceHistory).where(
                SpotPriceHistory.ticker == ticker,
                SpotPriceHistory.timestamp < ts
            ).order_by(desc(SpotPriceHistory.timestamp)).limit(10)
            hist_res = await self.db.execute(hist_stmt)
            hist_prices = hist_res.scalars().all()

            rolling_30m = 0.0
            rolling_60m = 0.0
            spot_15m = 0.0
            
            if len(hist_prices) > 0:
                spot_15m = (spot - float(hist_prices[0].spot_price)) / float(hist_prices[0].spot_price)
            if len(hist_prices) > 3:
                rolling_30m = (spot - float(hist_prices[2].spot_price)) / float(hist_prices[2].spot_price)
            if len(hist_prices) > 6:
                rolling_60m = (spot - float(hist_prices[5].spot_price)) / float(hist_prices[5].spot_price)

            # Temporal features
            is_india = ticker in ["NIFTY", "BANKNIFTY", "RELIANCE"] or ticker.endswith(".NS")
            market_close_hour = 15 if is_india else 16
            market_close_minute = 30 if is_india else 0
            
            close_time = ts.replace(hour=market_close_hour, minute=market_close_minute, second=0, microsecond=0)
            minutes_to_close = int((close_time - ts).total_seconds() / 60)
            minutes_to_close = max(0, minutes_to_close)

            session_half = 1 if ts.hour < 12 else 2
            day_of_week = ts.weekday()

            # Targets (direction and breaches in next 45 minutes)
            # Find price 45m in future
            future_ts = ts + timedelta(minutes=45)
            future_stmt = select(SpotPriceHistory).where(
                SpotPriceHistory.ticker == ticker,
                SpotPriceHistory.timestamp >= ts,
                SpotPriceHistory.timestamp <= future_ts
            ).order_by(SpotPriceHistory.timestamp.asc())
            future_res = await self.db.execute(future_stmt)
            future_prices = [float(p.spot_price) for p in future_res.scalars().all()]

            target_direction_45m = 0
            target_breach_up_45m = 0
            target_breach_down_45m = 0

            if future_prices:
                last_price = future_prices[-1]
                target_direction_45m = 1 if last_price > spot else -1 if last_price < spot else 0
                max_future = max(future_prices)
                min_future = min(future_prices)
                target_breach_up_45m = 1 if max_future > call_wall else 0
                target_breach_down_45m = 1 if min_future < put_wall else 0

            # EOD targets
            target_direction_1d = 0
            future_1d = ts + timedelta(days=1)
            eod_stmt = select(SpotPriceHistory).where(
                SpotPriceHistory.ticker == ticker,
                SpotPriceHistory.timestamp >= ts,
                SpotPriceHistory.timestamp <= future_1d
            ).order_by(desc(SpotPriceHistory.timestamp)).limit(1)
            eod_res = await self.db.execute(eod_stmt)
            eod_price = eod_res.scalar_one_or_none()
            if eod_price:
                target_direction_1d = 1 if float(eod_price.spot_price) > spot else -1

            feature_dict = {
                "snapshot_id": snapshot_id,
                "ticker": ticker,
                "timestamp": ts,
                "mode": mode,
                "total_gex_normalized": float(total_gex) / spot,
                "net_gex_sign": 1 if total_gex >= 0 else -1,
                "gex_concentration": gex_concentration,
                "call_wall_distance": call_wall_distance,
                "put_wall_distance": put_wall_distance,
                "gamma_flip_distance": gamma_flip_distance,
                "gex_zscore_30": 0.0, # Will be filled dynamically by rolling pipeline
                "put_call_oi_ratio": put_call_oi_ratio,
                "put_call_volume_ratio": put_call_volume_ratio,
                "bullish_sentiment_pct": bullish_sentiment_pct,
                "notional_flow_skew": 0.0,
                "atm_iv": atm_iv,
                "iv_skew_25d": iv_skew_25d,
                "iv_term_slope": 0.0,
                "realized_vs_implied": 0.05,
                "bid_ask_spread_zscore": 0.0,
                "intraday_return": 0.0,
                "rolling_return_30m": rolling_30m,
                "rolling_return_60m": rolling_60m,
                "vwap_deviation": 0.0,
                "spot_return_15m": spot_15m,
                "minutes_to_close": minutes_to_close,
                "session_half": session_half,
                "day_of_week": day_of_week,
                "volume_spike_ratio": 1.0,
                "oi_velocity": 0.0,
                "charm_decay_rate": total_charm / 1e3 if abs(total_charm) > 0 else 0.0,
                "vanna_exposure": total_vanna / 1e3 if abs(total_vanna) > 0 else 0.0,
                "target_direction_45m": target_direction_45m,
                "target_breach_up_45m": target_breach_up_45m,
                "target_breach_down_45m": target_breach_down_45m,
                "target_direction_1d": target_direction_1d,
                "target_direction_3d": target_direction_1d
            }

            return feature_dict
        except Exception as e:
            logger.error(f"Error computing snapshot features: {e}", exc_info=True)
            return None

    async def materialize_snapshots_in_range(self, ticker: str, start_date: datetime, end_date: datetime, mode: str = "0dte") -> int:
        """
        Materializes feature vectors for all snapshots within a date range and saves them to the DB.
        """
        try:
            stmt = select(OptionSnapshot).where(
                OptionSnapshot.ticker == ticker,
                OptionSnapshot.timestamp >= start_date,
                OptionSnapshot.timestamp <= end_date
            ).order_by(OptionSnapshot.timestamp.asc())
            res = await self.db.execute(stmt)
            snapshots = res.scalars().all()
            
            logger.info(f"Materializing features for {len(snapshots)} snapshots for {ticker}...")
            count = 0
            for snap in snapshots:
                # Check if already exists
                check_stmt = select(MLFeatureSnapshot).where(
                    MLFeatureSnapshot.snapshot_id == snap.id,
                    MLFeatureSnapshot.mode == mode
                )
                check_res = await self.db.execute(check_stmt)
                existing = check_res.scalar_one_or_none()
                if existing:
                    continue

                feat = await self.compute_snapshot_features(snap.id, mode)
                if feat:
                    new_feat = MLFeatureSnapshot(**feat)
                    self.db.add(new_feat)
                    count += 1

            await self.db.commit()
            logger.info(f"Successfully materialized {count} new feature snapshots.")
            return count
        except Exception as e:
            logger.error(f"Error materializing snapshots: {e}", exc_info=True)
            return 0
