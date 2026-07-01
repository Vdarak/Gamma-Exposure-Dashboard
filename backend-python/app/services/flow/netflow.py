import logging
from datetime import datetime, date
from typing import Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

logger = logging.getLogger("gamma-exposure-backend.flow.netflow")


class OptionsNetFlowService:
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def get_net_flow_data(
        self,
        ticker: str,
        query_date: Optional[str] = None,
        spot_percent: float = 15.0,
    ) -> Dict[str, Any]:
        """
        Calculates options net flow by strike for a given ticker and date.

        Uses a single PostgreSQL LAG() window-function query to classify each
        5-minute volume delta as 'bought' (last > midpoint) or 'written'
        (last < midpoint) directly in the database engine, avoiding loading
        hundreds of thousands of ORM objects into Python.

        The query also filters to ±spot_percent% of the latest spot price so
        the response only contains strikes the client will actually render.
        """
        t = ticker.upper()

        # ── 1. Resolve target date ────────────────────────────────────────
        if query_date:
            try:
                target_date = datetime.strptime(query_date, "%Y-%m-%d").date()
            except ValueError:
                target_date = date.today()
        else:
            latest_res = await self.db.execute(
                text("""
                    SELECT DATE(timestamp)
                    FROM option_snapshots
                    WHERE ticker = :ticker
                    ORDER BY timestamp DESC
                    LIMIT 1
                """),
                {"ticker": t},
            )
            row = latest_res.scalar()
            target_date = row if row else date.today()

        logger.info(f"Computing Net Flow for {t} on date {target_date}")

        # ── 2. Get latest spot price (from the most recent snapshot of that day) ─
        spot_res = await self.db.execute(
            text("""
                SELECT spot_price
                FROM option_snapshots
                WHERE ticker = :ticker
                  AND DATE(timestamp) = :target_date
                ORDER BY timestamp DESC
                LIMIT 1
            """),
            {"ticker": t, "target_date": target_date},
        )
        spot_row = spot_res.scalar()
        if spot_row is None:
            return {
                "success": False,
                "message": f"No options snapshots found for ticker {t} on {target_date}",
                "date": target_date.isoformat(),
                "ticker": t,
                "spotPrice": 0.0,
                "data": [],
            }

        spot_price = float(spot_row)
        pct = spot_percent / 100.0
        min_strike = spot_price * (1.0 - pct)
        max_strike = spot_price * (1.0 + pct)

        # ── 3. Single LAG window-function query for all flow classification ─
        #
        # This pushes the entire tick-classification loop into PostgreSQL C code.
        # LAG() compares each row's volume with the previous snapshot's volume
        # for the same (strike, option_type, expiration) partition, giving us
        # the delta volume per 5-minute interval without Python iteration.
        #
        # Rules:
        #   delta_vol > 0 AND last_price > midpoint  → bought
        #   delta_vol > 0 AND last_price < midpoint  → written
        #   delta_vol > 0 AND last_price == midpoint → split 50/50
        #   delta_vol <= 0                           → ignore (no new volume)
        #
        flow_res = await self.db.execute(
            text("""
                WITH ranked AS (
                    SELECT
                        od.strike,
                        od.option_type,
                        od.expiration,
                        od.volume,
                        od.last_price,
                        od.bid,
                        od.ask,
                        od.open_interest,
                        od.implied_volatility,
                        LAG(od.volume) OVER (
                            PARTITION BY od.strike, od.option_type, od.expiration
                            ORDER BY os.timestamp
                        ) AS prev_volume,
                        LAG(od.last_price) OVER (
                            PARTITION BY od.strike, od.option_type, od.expiration
                            ORDER BY os.timestamp
                        ) AS prev_last_price
                    FROM option_data od
                    JOIN option_snapshots os ON od.snapshot_id = os.id
                    WHERE os.ticker = :ticker
                      AND DATE(os.timestamp) = :target_date
                      AND od.strike BETWEEN :min_strike AND :max_strike
                ),
                flow_classified AS (
                    SELECT
                        strike,
                        option_type,
                        expiration,
                        last_price,
                        bid,
                        ask,
                        open_interest,
                        implied_volatility,
                        -- Volume delta for this interval
                        GREATEST(0, COALESCE(volume, 0) - COALESCE(prev_volume, 0)) AS delta_vol,
                        -- Midpoint of bid/ask
                        (COALESCE(bid, 0) + COALESCE(ask, 0)) / 2.0 AS midpoint,
                        volume AS cum_volume
                    FROM ranked
                    WHERE prev_volume IS NOT NULL
                )
                SELECT
                    strike,
                    option_type,
                    expiration,
                    MAX(last_price)          AS last_price,
                    MAX(bid)                 AS bid,
                    MAX(ask)                 AS ask,
                    MAX(cum_volume)          AS volume,
                    MAX(open_interest)       AS open_interest,
                    MAX(implied_volatility)  AS iv,
                    -- Bought = delta volume where last > midpoint
                    SUM(CASE
                        WHEN delta_vol > 0 AND midpoint > 0 AND last_price > midpoint
                        THEN delta_vol
                        WHEN delta_vol > 0 AND midpoint > 0 AND last_price = midpoint
                        THEN delta_vol / 2.0
                        WHEN delta_vol > 0 AND midpoint <= 0
                        THEN delta_vol / 2.0
                        ELSE 0
                    END) AS bought_volume,
                    -- Written = delta volume where last < midpoint
                    SUM(CASE
                        WHEN delta_vol > 0 AND midpoint > 0 AND last_price < midpoint
                        THEN delta_vol
                        WHEN delta_vol > 0 AND midpoint > 0 AND last_price = midpoint
                        THEN delta_vol / 2.0
                        WHEN delta_vol > 0 AND midpoint <= 0
                        THEN delta_vol / 2.0
                        ELSE 0
                    END) AS written_volume
                FROM flow_classified
                GROUP BY strike, option_type, expiration
                ORDER BY strike ASC, option_type ASC
            """),
            {
                "ticker": t,
                "target_date": target_date,
                "min_strike": min_strike,
                "max_strike": max_strike,
            },
        )

        rows = flow_res.mappings().all()

        # ── 4. Prior day close for OI/IV change proxy ─────────────────────
        start_dt = datetime.combine(target_date, datetime.min.time())

        prior_snap_res = await self.db.execute(
            text("""
                SELECT id FROM option_snapshots
                WHERE ticker = :ticker AND timestamp < :start_dt
                ORDER BY timestamp DESC LIMIT 1
            """),
            {"ticker": t, "start_dt": start_dt},
        )
        prior_snap_id = prior_snap_res.scalar()

        prior_data: Dict[tuple, dict] = {}
        if prior_snap_id:
            prior_res = await self.db.execute(
                text("""
                    SELECT strike, option_type, expiration,
                           open_interest, implied_volatility
                    FROM option_data
                    WHERE snapshot_id = :snap_id
                      AND strike BETWEEN :min_strike AND :max_strike
                """),
                {
                    "snap_id": prior_snap_id,
                    "min_strike": min_strike,
                    "max_strike": max_strike,
                },
            )
            for pr in prior_res.mappings().all():
                key = (float(pr["strike"]), pr["option_type"], str(pr["expiration"]))
                prior_data[key] = {
                    "oi": int(pr["open_interest"] or 0),
                    "iv": float(pr["implied_volatility"] or 0.0),
                }

        # ── 5. Build response payload ─────────────────────────────────────
        strikes_data = []
        for row in rows:
            strike = float(row["strike"])
            opt_type = row["option_type"]
            exp_str = str(row["expiration"])
            key = (strike, opt_type, exp_str)

            last_price = float(row["last_price"] or 0.0)
            bid = float(row["bid"] or 0.0)
            ask = float(row["ask"] or 0.0)
            vol_eod = int(row["volume"] or 0)
            oi_eod = int(row["open_interest"] or 0)
            iv_eod = float(row["iv"] or 0.0)
            bought_vol = float(row["bought_volume"] or 0.0)
            written_vol = float(row["written_volume"] or 0.0)

            prior = prior_data.get(key, {})
            oi_prior = prior.get("oi", 0)
            iv_prior = prior.get("iv", iv_eod)
            oi_change = oi_eod - oi_prior
            iv_change = iv_eod - iv_prior

            # EOD sentiment proxy based on OI + IV direction
            eod_sentiment = "Neutral"
            if oi_change > 0:
                if iv_change > 0.005:
                    eod_sentiment = "Bought to Open"
                elif iv_change < -0.005:
                    eod_sentiment = "Written to Open"
                else:
                    eod_sentiment = "Mixed Openings"
            elif oi_change < 0:
                eod_sentiment = "Positions Closed"

            net_contracts = bought_vol - written_vol
            net_premium = net_contracts * last_price * 100.0

            strikes_data.append({
                "strike": strike,
                "type": opt_type,
                "expiration": exp_str,
                "lastPrice": round(last_price, 4),
                "bid": round(bid, 4),
                "ask": round(ask, 4),
                "volume": vol_eod,
                "openInterest": oi_eod,
                "oiChange": oi_change,
                "iv": round(iv_eod * 100.0, 3),
                "ivChange": round(iv_change * 100.0, 3),
                "boughtVolume": round(bought_vol, 1),
                "writtenVolume": round(written_vol, 1),
                "netContracts": round(net_contracts, 1),
                "netPremium": round(net_premium, 2),
                "eodSentiment": eod_sentiment,
            })

        snap_count_res = await self.db.execute(
            text("""
                SELECT COUNT(*) FROM option_snapshots
                WHERE ticker = :ticker AND DATE(timestamp) = :target_date
            """),
            {"ticker": t, "target_date": target_date},
        )
        snap_count = snap_count_res.scalar() or 0

        return {
            "success": True,
            "date": target_date.isoformat(),
            "ticker": t,
            "spotPrice": spot_price,
            "spotRange": {"min": round(min_strike, 2), "max": round(max_strike, 2)},
            "snapshotCount": snap_count,
            "source": "scraped-midpoint-midtick" if snap_count > 1 else "eod-only-fallback",
            "data": strikes_data,
        }
