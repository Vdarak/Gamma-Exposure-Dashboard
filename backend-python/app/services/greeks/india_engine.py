"""
India-Adapted Gamma Exposure (GEX) Engine.

This engine computes dealer-weighted GEX in INR Crores per 1% spot move,
using the NSE participant-derived dealer positioning weights (ω_CE, ω_PE).

Key differences from the US GEX engine:
  1. Dealer positioning is computed from actual participant data, not assumed
  2. Contract sizes are index-specific (Nifty=25, BankNifty=15, Sensex=20)
  3. Output is scaled in INR Crores (1 Crore = 10^7 INR) per 1% spot move
  4. Gamma flip point is computed server-side via linear interpolation

Mathematical formulation:
  Dealer_Gamma_K = (ω_CE * OI_{K,CE} + ω_PE * OI_{K,PE}) × Γ_K
  GEX_K = (Dealer_Gamma_K × S × 0.01S × LotSize) / 10^7  [INR Crores]
  GEX_Total = Σ_K GEX_K
  Gamma Flip Point S* = interpolated S where GEX_Total(S*) = 0
"""
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, date

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.models.option_snapshot import OptionSnapshot, OptionData
from app.models.quant import DealerWeight
from app.services.ingestion.nse_participant import NSEParticipantParser
from app.services.greeks.engine import GreeksEngine
from app.config import get_lot_size, get_instrument

logger = logging.getLogger("gamma-exposure-backend.india-gex")

# 1 Crore = 10,000,000 INR
CRORE = 1e7


class IndiaGEXEngine:
    """
    Computes India-specific Gamma Exposure using dealer positioning weights.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def calculate_gex(
        self,
        ticker: str,
        expiry: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Compute Rupee GEX per strike and overall for an Indian index.

        Args:
            ticker: Symbol name (NIFTY, BANKNIFTY, SENSEX)
            expiry: Optional expiry filter (YYYY-MM-DD). If None, includes all expiries.

        Returns:
            Unified GEX response dict, or None if insufficient data.
        """
        ticker = ticker.upper()
        instrument = get_instrument(ticker)
        if not instrument:
            logger.error("Unknown ticker for India GEX: %s", ticker)
            return None

        lot_size = instrument["lot_size"]

        # 1. Get latest option snapshot from DB
        snap_stmt = (
            select(OptionSnapshot)
            .where(OptionSnapshot.ticker == ticker)
            .order_by(desc(OptionSnapshot.timestamp))
            .limit(1)
        )
        snap_res = await self.db.execute(snap_stmt)
        snapshot = snap_res.scalar_one_or_none()

        if not snapshot:
            logger.info("[IndiaGEX %s] No snapshot in DB — fetching live on-demand via Dhan...", ticker)
            try:
                from app.services.ingestion.dhan_client import DhanOptionChainClient
                from app.services.ingestion.saver import DataSaverService
                client = DhanOptionChainClient()
                live_snap = await client.get_normalized_snapshot(ticker)
                if live_snap:
                    saver = DataSaverService(self.db)
                    await saver.save_snapshot(live_snap)
                    snap_res = await self.db.execute(snap_stmt)
                    snapshot = snap_res.scalar_one_or_none()
            except Exception as e:
                logger.error("[IndiaGEX %s] On-demand live fetch failed: %s", ticker, e)

        if not snapshot:
            logger.warning("[IndiaGEX %s] No snapshot data available", ticker)
            return None

        spot_price = float(snapshot.spot_price)

        # 2. Fetch option contracts for this snapshot
        options_stmt = (
            select(OptionData)
            .where(OptionData.snapshot_id == snapshot.id)
            .order_by(OptionData.strike, OptionData.option_type)
        )
        if expiry:
            try:
                expiry_date = datetime.strptime(expiry, "%Y-%m-%d").date()
                options_stmt = options_stmt.where(OptionData.expiration == expiry_date)
            except ValueError:
                logger.warning("Invalid expiry format: %s (expected YYYY-MM-DD)", expiry)

        options_res = await self.db.execute(options_stmt)
        options = options_res.scalars().all()

        if not options:
            logger.warning("[IndiaGEX %s] No options data in snapshot %d", ticker, snapshot.id)
            return None

        # 3. Get dealer weights
        weights = await NSEParticipantParser.get_latest_weights(self.db)
        omega_ce = weights["omega_ce"]
        omega_pe = weights["omega_pe"]

        # 4. Compute GEX per strike
        # Each contract calculates its own GEX based on its exact DTE and IV, aggregated to strike
        strike_map: Dict[float, Dict[str, Any]] = {}
        total_gex_crores = 0.0

        # Dealer positioning weights:
        # Baseline is +1 for calls and -1 for puts.
        # Participant weights modulate the baseline: w_call = 1.0 + omega_ce, w_put = 1.0 + |omega_pe|
        w_call = 1.0 + float(omega_ce or 0.0)
        w_put = 1.0 + abs(float(omega_pe or 0.0))
        today = date.today()

        for opt in options:
            strike = float(opt.strike)
            # Skip corrupted exchange ghost strikes
            vol = int(opt.volume or 0)
            oi = int(opt.open_interest or 0)
            if vol == 0 and oi > 50000 and spot_price > 0 and abs(strike - spot_price) / spot_price > 0.03:
                continue

            if strike not in strike_map:
                strike_map[strike] = {
                    "strike": strike,
                    "call_oi": 0,
                    "put_oi": 0,
                    "gamma": 0.0,
                    "gex_crores": 0.0,
                    "call_iv": 0.0,
                    "put_iv": 0.0,
                }

            entry = strike_map[strike]
            iv = float(opt.implied_volatility or 0.0)
            sigma = (iv if iv < 1.0 else iv / 100.0) if iv > 0 else 0.16
            if sigma <= 0.01:
                sigma = 0.16

            dte_days = max(1, (opt.expiration - today).days)
            T = max(dte_days, 0.5) / 365.25

            greeks = GreeksEngine.calculate_bs_greeks(
                S=spot_price,
                K=strike,
                T=T,
                r=0.065,  # India risk-free rate ~6.5%
                sigma=sigma,
                option_type=opt.option_type,
            )
            gamma = greeks["gamma"]

            # Suppress far OTM wings (>5% from spot) if gamma is negligible
            if abs(strike - spot_price) / spot_price > 0.05 and gamma < 1e-7:
                gamma = 0.0

            entry["gamma"] = max(entry["gamma"], gamma)
            is_call = opt.option_type == "C"

            if is_call:
                entry["call_oi"] += oi
                entry["call_iv"] = iv
                contract_gex = (w_call * oi * gamma * spot_price * (0.01 * spot_price) * lot_size) / CRORE
                entry["gex_crores"] += contract_gex
                total_gex_crores += contract_gex
            else:
                entry["put_oi"] += oi
                entry["put_iv"] = iv
                contract_gex = (-w_put * oi * gamma * spot_price * (0.01 * spot_price) * lot_size) / CRORE
                entry["gex_crores"] += contract_gex
                total_gex_crores += contract_gex

        strike_records: List[Dict[str, Any]] = []
        for strike, data in sorted(strike_map.items()):
            strike_records.append({
                "strike": strike,
                "call_oi": data["call_oi"],
                "put_oi": data["put_oi"],
                "gamma": round(data["gamma"], 8),
                "gex_crores": round(data["gex_crores"], 4),
                "call_iv": round(data["call_iv"], 4),
                "put_iv": round(data["put_iv"], 4),
            })

        # 6. Find Gamma Flip Point
        flip_point = self._find_flip_point(strike_records, spot_price)

        # 7. Get available expiries for this snapshot
        exp_query = (
            select(OptionData.expiration)
            .where(OptionData.snapshot_id == snapshot.id)
            .distinct()
            .order_by(OptionData.expiration)
        )
        exp_res = await self.db.execute(exp_query)
        available_expiries = [row[0].isoformat() for row in exp_res.fetchall()]

        # Master regime anchor (Pillar 4): Spot >= Flip Point -> POSITIVE, Spot < Flip Point -> NEGATIVE
        if flip_point is not None:
            gamma_regime = "POSITIVE" if spot_price >= flip_point else "NEGATIVE"
        else:
            gamma_regime = "POSITIVE" if total_gex_crores >= 0 else "NEGATIVE"

        return {
            "market": "NSE",
            "symbol": ticker,
            "display_name": instrument.get("display_name", ticker),
            "spot_price": round(spot_price, 2),
            "total_gex": round(total_gex_crores, 2),
            "currency": "INR_CRORES",
            "gamma_regime": gamma_regime,
            "flip_point": flip_point,
            "lot_size": lot_size,
            "dealer_weights": {
                "omega_ce": round(omega_ce, 6),
                "omega_pe": round(omega_pe, 6),
                "date": weights.get("date"),
                "alpha": weights.get("alpha", 0.5),
                "is_fallback": weights.get("is_fallback", True),
            },
            "snapshot_timestamp": snapshot.timestamp.isoformat(),
            "available_expiries": available_expiries,
            "selected_expiry": expiry,
            "strikes": strike_records,
        }

    @staticmethod
    def _find_flip_point(
        strikes: List[Dict[str, Any]],
        spot: float,
    ) -> Optional[float]:
        """
        Find the gamma flip point — the interpolated underlying price
        where cumulative GEX transitions between positive and negative.

        Uses linear interpolation between adjacent strikes where GEX changes sign.
        Returns the strike closest to spot if multiple crossings exist.
        """
        if not strikes:
            return None

        crossings = []
        for i in range(len(strikes) - 1):
            s1, s2 = strikes[i], strikes[i + 1]
            gex1, gex2 = s1["gex_crores"], s2["gex_crores"]

            if (gex1 < 0 and gex2 > 0) or (gex1 > 0 and gex2 < 0):
                denom = gex2 - gex1
                if abs(denom) < 1e-10:
                    continue
                # Linear interpolation: find strike where GEX = 0
                flip = s1["strike"] + (0 - gex1) * (s2["strike"] - s1["strike"]) / denom
                crossings.append(round(flip, 2))

        if not crossings:
            return None

        # Return the crossing closest to current spot
        return min(crossings, key=lambda x: abs(x - spot))
