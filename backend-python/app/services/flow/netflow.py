import logging
from datetime import datetime, date, timedelta
from typing import List, Dict, Any, Optional
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func, and_
from app.models.option_snapshot import OptionSnapshot, OptionData

logger = logging.getLogger("gamma-exposure-backend.flow.netflow")

class OptionsNetFlowService:
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def get_net_flow_data(self, ticker: str, query_date: Optional[str] = None) -> Dict[str, Any]:
        """
        Calculates options net flow by strike for a given ticker and date.
        Combines:
        1. Intraday Bid-Ask Midpoint Tick Test (scraped throughout the day).
        2. EOD OI & IV change proxy (comparing EOD vs prior day close).
        """
        t = ticker.upper()
        
        # 1. Resolve date
        if query_date:
            try:
                target_date = datetime.strptime(query_date, "%Y-%m-%d").date()
            except ValueError:
                target_date = date.today()
        else:
            # Find the latest snapshot date in database
            latest_snap_stmt = select(func.date(OptionSnapshot.timestamp)).where(OptionSnapshot.ticker == t).order_by(desc(OptionSnapshot.timestamp)).limit(1)
            latest_res = await self.db.execute(latest_snap_stmt)
            target_date = latest_res.scalar() or date.today()

        logger.info(f"Computing Net Flow for {t} on date {target_date}")

        # 2. Fetch all snapshots for target date ordered by timestamp asc
        start_dt = datetime.combine(target_date, datetime.min.time())
        end_dt = datetime.combine(target_date, datetime.max.time())
        
        snaps_stmt = select(OptionSnapshot).where(
            and_(
                OptionSnapshot.ticker == t,
                OptionSnapshot.timestamp >= start_dt,
                OptionSnapshot.timestamp <= end_dt
            )
        ).order_by(OptionSnapshot.timestamp.asc())
        
        snaps_res = await self.db.execute(snaps_stmt)
        snapshots = snaps_res.scalars().all()

        if not snapshots:
            return {
                "success": False,
                "message": f"No options snapshots found for ticker {t} on {target_date}",
                "date": target_date.isoformat(),
                "ticker": t,
                "spotPrice": 0.0,
                "data": []
            }

        # Spot price is from the latest snapshot of that day
        latest_snap = snapshots[-1]
        spot_price = float(latest_snap.spot_price)

        # 3. Calculate Intraday Net Flow using Bid-Ask Midpoint test
        # We will loop through snaps and match contracts.
        # Key: (strike, option_type, expiration_str)
        # Value: {bought_volume: 0.0, written_volume: 0.0, last_price: 0.0, bid: 0, ask: 0}
        intraday_flow = {}

        # Cache option contracts for each snapshot to avoid querying the DB in a loop
        snap_contracts = {}
        for snap in snapshots:
            opts_stmt = select(OptionData).where(OptionData.snapshot_id == snap.id)
            opts_res = await self.db.execute(opts_stmt)
            snap_contracts[snap.id] = opts_res.scalars().all()

        # Run Lee-Ready tick test over successive snapshots
        for idx in range(len(snapshots) - 1):
            snap_curr = snapshots[idx]
            snap_next = snapshots[idx + 1]
            
            curr_contracts = {
                (float(o.strike), o.option_type, o.expiration.isoformat()): o 
                for o in snap_contracts[snap_curr.id]
            }
            next_contracts = {
                (float(o.strike), o.option_type, o.expiration.isoformat()): o 
                for o in snap_contracts[snap_next.id]
            }

            for key, opt_next in next_contracts.items():
                strike, opt_type, exp_str = key
                opt_curr = curr_contracts.get(key)
                
                # Cumulative volume on the day
                vol_curr = int(opt_curr.volume or 0) if opt_curr else 0
                vol_next = int(opt_next.volume or 0)
                
                # Delta volume traded in this 5-minute interval
                delta_vol = vol_next - vol_curr
                if delta_vol <= 0:
                    continue

                last_price = float(opt_next.last_price or 0.0)
                bid = float(opt_next.bid or 0.0)
                ask = float(opt_next.ask or 0.0)
                midpoint = (bid + ask) / 2.0

                if key not in intraday_flow:
                    intraday_flow[key] = {
                        "bought_volume": 0.0,
                        "written_volume": 0.0,
                        "last_price": last_price,
                        "bid": bid,
                        "ask": ask
                    }

                # Save latest quotes
                intraday_flow[key]["last_price"] = last_price
                intraday_flow[key]["bid"] = bid
                intraday_flow[key]["ask"] = ask

                # Midpoint Classification Test
                if ask > bid and bid > 0:
                    if last_price > midpoint:
                        # Buyer initiated
                        intraday_flow[key]["bought_volume"] += delta_vol
                    elif last_price < midpoint:
                        # Seller initiated (written)
                        intraday_flow[key]["written_volume"] += delta_vol
                    else:
                        # Split 50/50
                        intraday_flow[key]["bought_volume"] += delta_vol / 2.0
                        intraday_flow[key]["written_volume"] += delta_vol / 2.0
                else:
                    # Fallback when spread is not available or invalid: split 50/50
                    intraday_flow[key]["bought_volume"] += delta_vol / 2.0
                    intraday_flow[key]["written_volume"] += delta_vol / 2.0

        # 4. Calculate EOD OI & IV changes (Comparing EOD of target_date vs prior close)
        # Find prior day close snapshot (last snapshot before start_dt)
        prior_snap_stmt = select(OptionSnapshot).where(
            and_(
                OptionSnapshot.ticker == t,
                OptionSnapshot.timestamp < start_dt
            )
        ).order_by(desc(OptionSnapshot.timestamp)).limit(1)
        
        prior_res = await self.db.execute(prior_snap_stmt)
        prior_snap = prior_res.scalar_one_or_none()

        prior_contracts = {}
        if prior_snap:
            prior_opts_stmt = select(OptionData).where(OptionData.snapshot_id == prior_snap.id)
            prior_opts_res = await self.db.execute(prior_opts_stmt)
            prior_contracts = {
                (float(o.strike), o.option_type, o.expiration.isoformat()): o 
                for o in prior_opts_res.scalars().all()
            }

        latest_contracts = {
            (float(o.strike), o.option_type, o.expiration.isoformat()): o 
            for o in snap_contracts[latest_snap.id]
        }

        # 5. Build combined response payload sorted by strike and option type
        strikes_data = []
        
        # Merge keys from intraday and latest EOD snapshots
        all_keys = set(latest_contracts.keys()).union(intraday_flow.keys())

        for key in all_keys:
            strike, opt_type, exp_str = key
            opt_latest = latest_contracts.get(key)
            opt_prior = prior_contracts.get(key)
            flow_intra = intraday_flow.get(key, {"bought_volume": 0.0, "written_volume": 0.0})

            # Base EOD metrics
            vol_eod = int(opt_latest.volume or 0) if opt_latest else 0
            oi_eod = int(opt_latest.open_interest or 0) if opt_latest else 0
            last_price = float(opt_latest.last_price or 0.0) if opt_latest else 0.0
            iv_eod = float(opt_latest.implied_volatility or 0.0) if opt_latest else 0.0
            bid = float(opt_latest.bid or 0.0) if opt_latest else 0.0
            ask = float(opt_latest.ask or 0.0) if opt_latest else 0.0

            # EOD Open Interest & IV Change
            oi_prior = int(opt_prior.open_interest or 0) if opt_prior else 0
            iv_prior = float(opt_prior.implied_volatility or 0.0) if opt_prior else iv_eod

            oi_change = oi_eod - oi_prior
            iv_change = iv_eod - iv_prior

            # EOD Flow Classifier (OI & IV Proxy)
            eod_sentiment = "Neutral"
            if oi_change > 0:
                if iv_change > 0.005:  # Positive IV shift (> 0.5% point)
                    eod_sentiment = "Bought to Open"
                elif iv_change < -0.005:
                    eod_sentiment = "Written to Open"
                else:
                    eod_sentiment = "Mixed Openings"
            elif oi_change < 0:
                eod_sentiment = "Positions Closed"

            # Intraday net flow calculations
            bought_vol = flow_intra["bought_volume"]
            written_vol = flow_intra["written_volume"]
            net_contracts = bought_vol - written_vol
            net_premium = net_contracts * last_price * 100.0

            strikes_data.append({
                "strike": strike,
                "type": opt_type,
                "expiration": exp_str,
                "lastPrice": last_price,
                "bid": bid,
                "ask": ask,
                "volume": vol_eod,
                "openInterest": oi_eod,
                "oiChange": oi_change,
                "iv": iv_eod * 100.0,
                "ivChange": iv_change * 100.0,
                "boughtVolume": bought_vol,
                "writtenVolume": written_vol,
                "netContracts": net_contracts,
                "netPremium": net_premium,
                "eodSentiment": eod_sentiment
            })

        # Sort strikes data by strike price asc, then option type (Call then Put)
        strikes_data.sort(key=lambda x: (x["strike"], x["type"] == "P"))

        return {
            "success": True,
            "date": target_date.isoformat(),
            "ticker": t,
            "spotPrice": spot_price,
            "source": "scraped-midpoint-midtick" if len(snapshots) > 1 else "eod-only-fallback",
            "data": strikes_data
        }
