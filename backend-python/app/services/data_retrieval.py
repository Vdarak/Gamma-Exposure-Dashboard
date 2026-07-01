from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func, text
from datetime import datetime, date, timedelta
from typing import List, Dict, Any, Optional
from app.models.option_snapshot import OptionSnapshot, OptionData

class DataRetrievalService:
    """
    Service to fetch stored option chain snapshot data, EOD historical trends,
    and metadata for time machine queries.
    """
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def get_current_data(self, ticker: str) -> Optional[Dict[str, Any]]:
        """
        Fetches the most recent options snapshot and contract details for a ticker.
        """
        t = ticker.upper()
        
        # 1. Fetch latest snapshot
        snap_stmt = select(OptionSnapshot).where(OptionSnapshot.ticker == t).order_by(desc(OptionSnapshot.timestamp)).limit(1)
        snap_res = await self.db.execute(snap_stmt)
        snap = snap_res.scalar_one_or_none()
        
        if not snap:
            return None

        # 2. Fetch contracts
        options_stmt = select(OptionData).where(OptionData.snapshot_id == snap.id).order_by(OptionData.strike, OptionData.option_type)
        options_res = await self.db.execute(options_stmt)
        options = options_res.scalars().all()

        return {
            "id": snap.id,
            "ticker": snap.ticker,
            "timestamp": snap.timestamp,
            "spotPrice": float(snap.spot_price),
            "dataCount": len(options),
            "market": snap.market,
            "options": [
                {
                    "strike": float(opt.strike),
                    "type": opt.option_type,
                    "expiration": opt.expiration,
                    "lastPrice": float(opt.last_price or 0.0),
                    "bid": float(opt.bid) if opt.bid is not None else None,
                    "ask": float(opt.ask) if opt.ask is not None else None,
                    "volume": int(opt.volume or 0),
                    "openInterest": int(opt.open_interest or 0),
                    "impliedVolatility": float(opt.implied_volatility or 0.0),
                    "delta": float(opt.delta) if opt.delta is not None else None,
                    "gamma": float(opt.gamma) if opt.gamma is not None else None,
                    "theta": float(opt.theta) if opt.theta is not None else None,
                    "vega": float(opt.vega) if opt.vega is not None else None,
                    "rho": float(opt.rho) if opt.rho is not None else None
                }
                for opt in options
            ]
        }

    async def get_data_at_timestamp(self, ticker: str, ts: datetime) -> Optional[Dict[str, Any]]:
        """
        Finds the closest option snapshot matching a given timestamp.
        """
        t = ticker.upper()
        
        # Use ABS(EXTRACT(EPOCH FROM ...)) via raw SQL or SQLAlchemy functions
        query = """
            SELECT id, ticker, timestamp, spot_price, market
            FROM option_snapshots
            WHERE ticker = :ticker
            ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - :ts)))
            LIMIT 1
        """
        
        snap_res = await self.db.execute(text(query), {"ticker": t, "ts": ts})
        snap = snap_res.fetchone()
        
        if not snap:
            return None

        snapshot_id, _, timestamp, spot_price, market = snap

        # Fetch options
        options_stmt = select(OptionData).where(OptionData.snapshot_id == snapshot_id).order_by(OptionData.strike, OptionData.option_type)
        options_res = await self.db.execute(options_stmt)
        options = options_res.scalars().all()

        return {
            "id": snapshot_id,
            "ticker": t,
            "timestamp": timestamp,
            "spotPrice": float(spot_price),
            "dataCount": len(options),
            "market": market,
            "options": [
                {
                    "strike": float(opt.strike),
                    "type": opt.option_type,
                    "expiration": opt.expiration,
                    "lastPrice": float(opt.last_price or 0.0),
                    "bid": float(opt.bid) if opt.bid is not None else None,
                    "ask": float(opt.ask) if opt.ask is not None else None,
                    "volume": int(opt.volume or 0),
                    "openInterest": int(opt.open_interest or 0),
                    "impliedVolatility": float(opt.implied_volatility or 0.0),
                    "delta": float(opt.delta) if opt.delta is not None else None,
                    "gamma": float(opt.gamma) if opt.gamma is not None else None,
                    "theta": float(opt.theta) if opt.theta is not None else None,
                    "vega": float(opt.vega) if opt.vega is not None else None,
                    "rho": float(opt.rho) if opt.rho is not None else None
                }
                for opt in options
            ]
        }

    async def get_historical_data(
        self,
        ticker: str,
        hours_back: Optional[int] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """
        Fetches historical snapshots for a ticker within a time range.
        """
        t = ticker.upper()
        
        # Assemble query parameters
        snap_stmt = select(OptionSnapshot).where(OptionSnapshot.ticker == t)
        
        if hours_back:
            # Find the latest snapshot timestamp for this ticker to anchor our relative query window
            latest_stmt = select(func.max(OptionSnapshot.timestamp)).where(OptionSnapshot.ticker == t)
            latest_res = await self.db.execute(latest_stmt)
            latest_ts = latest_res.scalar()
            
            if latest_ts:
                cutoff = latest_ts - timedelta(hours=hours_back)
                snap_stmt = snap_stmt.where(OptionSnapshot.timestamp >= cutoff)
            else:
                return []
        elif start_date and end_date:
            snap_stmt = snap_stmt.where(OptionSnapshot.timestamp.between(start_date, end_date))
            
        snap_stmt = snap_stmt.order_by(desc(OptionSnapshot.timestamp))
        snap_res = await self.db.execute(snap_stmt)
        snapshots = snap_res.scalars().all()
        
        result = []
        for snap in snapshots:
            options_stmt = select(OptionData).where(OptionData.snapshot_id == snap.id).order_by(OptionData.strike, OptionData.option_type)
            options_res = await self.db.execute(options_stmt)
            options = options_res.scalars().all()
            
            result.append({
                "id": snap.id,
                "ticker": snap.ticker,
                "timestamp": snap.timestamp,
                "spotPrice": float(snap.spot_price),
                "dataCount": len(options),
                "market": snap.market,
                "options": [
                    {
                        "strike": float(opt.strike),
                        "type": opt.option_type,
                        "expiration": opt.expiration,
                        "lastPrice": float(opt.last_price or 0.0),
                        "bid": float(opt.bid) if opt.bid is not None else None,
                        "ask": float(opt.ask) if opt.ask is not None else None,
                        "volume": int(opt.volume or 0),
                        "openInterest": int(opt.open_interest or 0),
                        "impliedVolatility": float(opt.implied_volatility or 0.0),
                        "delta": float(opt.delta) if opt.delta is not None else None,
                        "gamma": float(opt.gamma) if opt.gamma is not None else None,
                        "theta": float(opt.theta) if opt.theta is not None else None,
                        "vega": float(opt.vega) if opt.vega is not None else None,
                        "rho": float(opt.rho) if opt.rho is not None else None
                    }
                    for opt in options
                ]
            })
            
        return result

    async def get_available_timestamps(self, ticker: str, days_back: int = 3) -> List[Dict[str, Any]]:
        """
        Returns list of available snapshot timestamps (useful for time machine slider).
        """
        t = ticker.upper()
        cutoff = datetime.utcnow() - timedelta(days=days_back)
        
        stmt = (
            select(OptionSnapshot.timestamp, OptionSnapshot.spot_price)
            .where(OptionSnapshot.ticker == t, OptionSnapshot.timestamp >= cutoff)
            .order_by(OptionSnapshot.timestamp.asc())
        )
        res = await self.db.execute(stmt)
        rows = res.fetchall()
        
        return [
            {"timestamp": row[0], "spotPrice": float(row[1])}
            for row in rows
        ]

    async def get_data_statistics(self, ticker: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Returns database row counts and average contracts per snapshot.
        """
        query = """
            SELECT 
                ticker,
                COUNT(*) as snapshot_count,
                MIN(timestamp) as oldest_snapshot,
                MAX(timestamp) as newest_snapshot,
                AVG(data_count) as avg_options_per_snapshot
            FROM option_snapshots
        """
        
        params = {}
        if ticker:
            query += " WHERE ticker = :ticker"
            params["ticker"] = ticker.upper()
            
        query += " GROUP BY ticker ORDER BY ticker"
        
        res = await self.db.execute(text(query), params)
        rows = res.fetchall()
        
        return [
            {
                "ticker": row[0],
                "snapshot_count": int(row[1]),
                "oldest_snapshot": row[2],
                "newest_snapshot": row[3],
                "avg_options_per_snapshot": float(row[4]) if row[4] else 0.0
            }
            for row in rows
        ]

    async def get_available_expiries(self, ticker: str, ts: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """
        Fetches expiry dates and count of options matching the closest snapshot to ts.
        """
        t = ticker.upper()
        
        if ts:
            # Subquery to resolve closest snapshot
            closest_query = """
                SELECT id
                FROM option_snapshots
                WHERE ticker = :ticker
                ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - :ts)))
                LIMIT 1
            """
            snap_res = await self.db.execute(text(closest_query), {"ticker": t, "ts": ts})
            snap_id = snap_res.scalar()
        else:
            # Subquery to resolve latest snapshot
            latest_query = """
                SELECT id
                FROM option_snapshots
                WHERE ticker = :ticker
                ORDER BY timestamp DESC
                LIMIT 1
            """
            snap_res = await self.db.execute(text(latest_query), {"ticker": t})
            snap_id = snap_res.scalar()

        if not snap_id:
            return []

        # Fetch expiries
        exp_query = """
            SELECT expiration, COUNT(*) as option_count
            FROM option_data
            WHERE snapshot_id = :snap_id
            GROUP BY expiration
            ORDER BY expiration
        """
        res = await self.db.execute(text(exp_query), {"snap_id": snap_id})
        rows = res.fetchall()

        return [
            {
                "expiration": row[0],
                "optionCount": int(row[1])
            }
            for row in rows
        ]

    async def get_intraday_gex_flow(self, ticker: str, d: date) -> List[Dict[str, Any]]:
        """
        Returns intraday 0DTE GEX snapshots for the charts.
        """
        t = ticker.upper()
        query = """
            SELECT 
                s.id as snapshot_id,
                s.timestamp,
                s.spot_price,
                o.strike,
                o.option_type,
                o.open_interest,
                o.volume,
                o.gamma
            FROM option_snapshots s
            JOIN option_data o ON s.id = o.snapshot_id
            WHERE s.ticker = :ticker 
                AND s.timestamp::DATE = :date
                AND o.expiration = s.timestamp::DATE
            ORDER BY s.timestamp ASC, o.strike ASC
        """
        
        res = await self.db.execute(text(query), {"ticker": t, "date": d})
        rows = res.fetchall()

        snapshots_map = {}
        for row in rows:
            snap_id, ts, spot_price, strike, opt_type, oi, vol, gamma = row
            ts_str = ts.isoformat()
            
            spot = float(spot_price)
            strike_str = f"{float(strike):.1f}"
            oi = int(oi or 0)
            vol = int(vol or 0)
            gamma = float(gamma or 0.0)

            # GEX calculation
            gex = (1.0 if opt_type == 'C' else -1.0) * spot * spot * gamma * oi

            if ts_str not in snapshots_map:
                snapshots_map[ts_str] = {
                    "timestamp": ts,
                    "spotPrice": spot,
                    "strikes": {}
                }

            snap = snapshots_map[ts_str]
            if strike_str not in snap["strikes"]:
                snap["strikes"][strike_str] = {"gex": 0.0, "volume": 0, "openInterest": 0}
                
            snap["strikes"][strike_str]["gex"] += gex
            snap["strikes"][strike_str]["volume"] += vol
            snap["strikes"][strike_str]["openInterest"] += oi

        return list(snapshots_map.values())

    async def get_historical_gex_trend(self, ticker: str) -> List[Dict[str, Any]]:
        """
        Returns closing 0DTE GEX trends for the last 30 trading days.
        """
        t = ticker.upper()
        query = """
            WITH daily_closing_snapshots AS (
                SELECT DISTINCT ON (timestamp::DATE)
                    id, timestamp, spot_price
                FROM option_snapshots
                WHERE ticker = :ticker
                ORDER BY timestamp::DATE DESC, timestamp DESC
                LIMIT 30
            )
            SELECT 
                dcs.id,
                dcs.timestamp,
                dcs.spot_price as "spotPrice",
                COALESCE(SUM((CASE WHEN o.option_type = 'C' THEN 1.0 ELSE -1.0 END) * dcs.spot_price * dcs.spot_price * o.gamma * o.open_interest), 0.0) as "totalGex"
            FROM daily_closing_snapshots dcs
            LEFT JOIN option_data o ON dcs.id = o.snapshot_id AND o.expiration = dcs.timestamp::DATE
            GROUP BY dcs.id, dcs.timestamp, dcs.spot_price
            ORDER BY dcs.timestamp ASC
        """
        
        res = await self.db.execute(text(query), {"ticker": t})
        rows = res.fetchall()

        return [
            {
                "timestamp": row[1],
                "spotPrice": float(row[2]),
                "totalGex": float(row[3])
            }
            for row in rows
        ]
