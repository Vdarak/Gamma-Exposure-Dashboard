import logging
from datetime import datetime, date, timezone, timedelta
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from app.models.option_snapshot import OptionSnapshot, OptionData
from app.models.quant import EarningsDate
from app.config import settings

logger = logging.getLogger("gamma-exposure-backend.flow")

class OptionFlowItem(BaseModel):
    id: str
    time: str
    ticker: str
    contractName: str
    optionType: str
    strike: float
    expiration: str
    stockPrice: float
    lastPrice: float
    changePercent: Optional[float] = None
    volume: int
    openInterest: int
    oiChange: int
    notionalChange: float
    timeframeType: str
    oi5dChangePercent: float
    otmPercent: float
    ivPercent: float
    iv5dPointDiff: float
    delta: float
    dte: int
    earningsRemainingDays: Optional[int] = None
    bid: Optional[float] = None
    ask: Optional[float] = None

class FlowAggregates(BaseModel):
    dominantSentiment: str
    bullishSentimentPercent: float
    putCallRatio: float
    callVolume: int
    putVolume: int
    callPremium: float
    putPremium: float
    callPercentage: float
    putPercentage: float

class OptionsFlowResponse(BaseModel):
    success: bool
    data: List[OptionFlowItem]
    aggregates: FlowAggregates
    topNotionalStrikes: List[OptionFlowItem]

class OptionsFlowService:
    """
    Service to compute and analyze options flow (volume, open interest changes, sentiment, and notional premium).
    """
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def get_options_flow_data(
        self,
        ticker: str,
        timeframe: str = "Intraday",
        custom_start_date: Optional[str] = None
    ) -> OptionsFlowResponse:
        t = ticker.upper()
        
        try:
            # 1. Check if database has snapshots for this ticker
            result_count = await self.db.execute(
                select(func.count(OptionSnapshot.id)).where(OptionSnapshot.ticker == t)
            )
            snapshot_count = result_count.scalar() or 0

            # If 0 snapshots, pull initial data synchronously to populate the database
            if snapshot_count == 0:
                logger.info(f"No snapshots found for {t}. Fetching initial options snapshot...")
                from app.services.ingestion.cboe import CBOEScraperService
                from app.services.ingestion.nse_live import NSELiveScraperService
                from app.services.ingestion.saver import DataSaverService
                
                is_index = t in {"NIFTY", "BANKNIFTY", "RELIANCE"}  # Simplistic check
                scraper = NSELiveScraperService() if is_index else CBOEScraperService()
                snap = await scraper.get_normalized_snapshot(t)
                
                if snap:
                    saver = DataSaverService(self.db)
                    await saver.save_snapshot(snap)
                else:
                    return self._create_empty_response()

            # 2. Query latest snapshot metadata
            latest_snap_result = await self.db.execute(
                select(OptionSnapshot.id, OptionSnapshot.spot_price, OptionSnapshot.timestamp)
                .where(OptionSnapshot.ticker == t)
                .order_by(desc(OptionSnapshot.timestamp))
                .limit(1)
            )
            latest_row = latest_snap_result.fetchone()
            if not latest_row:
                return self._create_empty_response()

            latest_snap_id, spot_price, snap_time = latest_row
            spot_price = float(spot_price)

            # 3. Find comparison snapshot ID based on timeframe
            compare_snap_id = latest_snap_id
            compare_time = None

            # Get UTC midnight of today for comparisons
            today_start = datetime.combine(date.today(), datetime.min.time())

            if timeframe == "Intraday":
                # Find earliest snapshot of today
                result = await self.db.execute(
                    select(OptionSnapshot.id, OptionSnapshot.timestamp)
                    .where(OptionSnapshot.ticker == t, OptionSnapshot.timestamp >= today_start)
                    .order_by(OptionSnapshot.timestamp.asc())
                    .limit(1)
                )
                row = result.fetchone()
                if row:
                    compare_snap_id, compare_time = row
                
                # Fallback: if only 1 snapshot today, compare to yesterday's close
                if compare_snap_id == latest_snap_id:
                    fallback_result = await self.db.execute(
                        select(OptionSnapshot.id, OptionSnapshot.timestamp)
                        .where(OptionSnapshot.ticker == t, OptionSnapshot.timestamp < today_start)
                        .order_by(desc(OptionSnapshot.timestamp))
                        .limit(1)
                    )
                    row = fallback_result.fetchone()
                    if row:
                        compare_snap_id, compare_time = row

            elif timeframe == "Daily":
                # Find the last snapshot from yesterday
                result = await self.db.execute(
                    select(OptionSnapshot.id, OptionSnapshot.timestamp)
                    .where(OptionSnapshot.ticker == t, OptionSnapshot.timestamp < today_start)
                    .order_by(desc(OptionSnapshot.timestamp))
                    .limit(1)
                )
                row = result.fetchone()
                if row:
                    compare_snap_id, compare_time = row

            elif timeframe == "5-Day":
                # Find snapshot closest to 5 days ago
                five_days_ago = datetime.utcnow() - timedelta(days=5)
                result = await self.db.execute(
                    select(OptionSnapshot.id, OptionSnapshot.timestamp)
                    .where(OptionSnapshot.ticker == t, OptionSnapshot.timestamp <= five_days_ago)
                    .order_by(desc(OptionSnapshot.timestamp))
                    .limit(1)
                )
                row = result.fetchone()
                if row:
                    compare_snap_id, compare_time = row
                else:
                    # Fallback to earliest snapshot
                    fallback_result = await self.db.execute(
                        select(OptionSnapshot.id, OptionSnapshot.timestamp)
                        .where(OptionSnapshot.ticker == t)
                        .order_by(OptionSnapshot.timestamp.asc())
                        .limit(1)
                    )
                    row = fallback_result.fetchone()
                    if row:
                        compare_snap_id, compare_time = row

            elif timeframe == "Custom" and custom_start_date:
                compare_date = datetime.fromisoformat(custom_start_date)
                result = await self.db.execute(
                    select(OptionSnapshot.id, OptionSnapshot.timestamp)
                    .where(OptionSnapshot.ticker == t, OptionSnapshot.timestamp <= compare_date)
                    .order_by(desc(OptionSnapshot.timestamp))
                    .limit(1)
                )
                row = result.fetchone()
                if row:
                    compare_snap_id, compare_time = row
                else:
                    # Fallback to earliest snapshot
                    fallback_result = await self.db.execute(
                        select(OptionSnapshot.id, OptionSnapshot.timestamp)
                        .where(OptionSnapshot.ticker == t)
                        .order_by(OptionSnapshot.timestamp.asc())
                        .limit(1)
                    )
                    row = fallback_result.fetchone()
                    if row:
                        compare_snap_id, compare_time = row

            logger.info(f"Comparing snapshot {latest_snap_id} vs comparison snapshot {compare_snap_id}")

            # 4. Query option data for both snapshots joined together
            query = """
                SELECT 
                    o_lat.strike, 
                    o_lat.option_type, 
                    o_lat.expiration, 
                    o_lat.last_price as latest_price, 
                    o_lat.bid as latest_bid, 
                    o_lat.ask as latest_ask, 
                    o_lat.volume as latest_volume, 
                    o_lat.open_interest as latest_oi, 
                    o_lat.implied_volatility as latest_iv, 
                    o_lat.delta as latest_delta, 
                    o_lat.theta as latest_theta,
                    o_comp.open_interest as compare_oi,
                    o_comp.implied_volatility as compare_iv,
                    o_comp.last_price as compare_price
                FROM option_data o_lat
                LEFT JOIN option_data o_comp ON 
                    o_lat.strike = o_comp.strike AND 
                    o_lat.option_type = o_comp.option_type AND 
                    o_lat.expiration = o_comp.expiration AND 
                    o_comp.snapshot_id = :compare_id
                WHERE o_lat.snapshot_id = :latest_id
            """
            
            from sqlalchemy import text
            options_result = await self.db.execute(
                text(query),
                {"latest_id": latest_snap_id, "compare_id": compare_snap_id}
            )
            rows = options_result.fetchall()

            # 5. Query next earnings date
            earnings_result = await self.db.execute(
                select(EarningsDate.next_earnings_date).where(EarningsDate.ticker == t)
            )
            next_earnings = earnings_result.scalar()
            earnings_remaining_days = None
            if next_earnings:
                earnings_remaining_days = max(0, (next_earnings - date.today()).days)

            # 6. Map and calculate options flow items
            total_call_vol = 0
            total_put_vol = 0
            total_call_premium = 0
            total_put_premium = 0
            bullish_premium = 0
            bearish_premium = 0

            flow_items = []
            for row in rows:
                strike = float(row.strike)
                is_call = row.option_type == "C"
                exp_date = row.expiration.date() if hasattr(row.expiration, 'date') else row.expiration
                exp_str = exp_date.isoformat()
                type_label = "Call" if is_call else "Put"
                
                last_price = float(row.latest_price or 0.0)
                volume = int(row.latest_volume or 0)
                open_interest = int(row.latest_oi or 0)
                compare_oi = int(row.compare_oi or 0)
                current_iv = float(row.latest_iv or 0.0)
                compare_iv = float(row.compare_iv or current_iv)
                compare_price = float(row.compare_price or last_price)

                # OI calculations
                oi_change = open_interest - compare_oi
                notional_change = abs(oi_change) * last_price * 100.0

                # Sentiment
                if is_call:
                    total_call_vol += volume
                    total_call_premium += notional_change
                    if oi_change > 0:
                        bullish_premium += notional_change
                    elif oi_change < 0:
                        bearish_premium += notional_change
                else:
                    total_put_vol += volume
                    total_put_premium += notional_change
                    if oi_change > 0:
                        bearish_premium += notional_change
                    elif oi_change < 0:
                        bullish_premium += notional_change

                # DTE
                dte = max(0, (exp_date - date.today()).days)

                # OTM %
                otm_percent = 0.0
                if is_call:
                    otm_percent = ((strike - spot_price) / spot_price) * 100.0 if strike > spot_price else 0.0
                else:
                    otm_percent = ((spot_price - strike) / spot_price) * 100.0 if strike < spot_price else 0.0

                # Percent change proxy
                oi_5d_change_percent = (oi_change / compare_oi) * 100.0 if compare_oi > 0 else 0.0
                change_percent = ((last_price - compare_price) / compare_price) * 100.0 if compare_price > 0.0 else None
                iv_5d_point_diff = (current_iv - compare_iv) * 100.0

                # Delta
                delta = float(row.latest_delta or 0.0)
                if delta == 0.0:
                    # Fallback delta proxy
                    distance = abs(strike - spot_price) / spot_price
                    delta = max(0.05, min(0.95, 0.5 - (1 if is_call else -1) * (distance * 2 if strike > spot_price else -distance * 2)))
                    if not is_call:
                        delta = -delta

                # Format time
                time_str = snap_time.strftime("%m/%d %H:%M:%S")

                item = OptionFlowItem(
                    id=f"{t}-{exp_str}-{strike:.1f}-{row.option_type}",
                    time=time_str,
                    ticker=t,
                    contractName=f"{strike:.1f} {type_label} {exp_str}",
                    optionType=type_label,
                    strike=strike,
                    expiration=exp_str,
                    stockPrice=spot_price,
                    lastPrice=last_price or (float(row.latest_bid or 0) + float(row.latest_ask or 0)) / 2.0 or 0.0,
                    changePercent=change_percent,
                    volume=volume,
                    openInterest=open_interest,
                    oiChange=oi_change,
                    notionalChange=notional_change,
                    timeframeType=timeframe,
                    oi5dChangePercent=oi_5d_change_percent,
                    otmPercent=otm_percent,
                    ivPercent=current_iv * 100.0,
                    iv5dPointDiff=iv_5d_point_diff,
                    delta=abs(delta),
                    dte=dte,
                    earningsRemainingDays=earnings_remaining_days,
                    bid=float(row.latest_bid) if row.latest_bid is not None else None,
                    ask=float(row.latest_ask) if row.latest_ask is not None else None
                )
                flow_items.append(item)

            # 7. Calculate Aggregates
            total_premium = bullish_premium + bearish_premium
            bullish_sentiment_percent = 50.0
            if total_premium > 0:
                bullish_sentiment_percent = (bullish_premium / total_premium) * 100.0

            dominant_sentiment = "Neutral"
            if bullish_sentiment_percent > 55.0:
                dominant_sentiment = "Bullish"
            elif bullish_sentiment_percent < 45.0:
                dominant_sentiment = "Bearish"

            put_call_ratio = total_put_vol / total_call_vol if total_call_vol > 0 else 0.0
            total_vol = total_call_vol + total_put_vol
            call_percentage = (total_call_vol / total_vol) * 100.0 if total_vol > 0 else 50.0
            put_percentage = (total_put_vol / total_vol) * 100.0 if total_vol > 0 else 50.0

            aggregates = FlowAggregates(
                dominantSentiment=dominant_sentiment,
                bullishSentimentPercent=bullish_sentiment_percent,
                putCallRatio=put_call_ratio,
                callVolume=total_call_vol,
                putVolume=total_put_vol,
                callPremium=total_call_premium,
                putPremium=total_put_premium,
                callPercentage=call_percentage,
                putPercentage=put_percentage
            )

            # 8. Sort and extract top 5 strikes by Notional Change
            sorted_by_notional = sorted(flow_items, key=lambda x: x.notionalChange, reverse=True)
            top_notional_strikes = sorted_by_notional[:5]

            return OptionsFlowResponse(
                success=True,
                data=flow_items,
                aggregates=aggregates,
                topNotionalStrikes=top_notional_strikes
            )

        except Exception as e:
            logger.error(f"Error retrieving option flow data for {ticker}: {e}")
            return self._create_empty_response()

    def _create_empty_response(self) -> OptionsFlowResponse:
        default_aggs = FlowAggregates(
            dominantSentiment="Neutral",
            bullishSentimentPercent=50.0,
            putCallRatio=1.0,
            callVolume=0,
            putVolume=0,
            callPremium=0.0,
            putPremium=0.0,
            callPercentage=50.0,
            putPercentage=50.0
        )
        return OptionsFlowResponse(
            success=False,
            data=[],
            aggregates=default_aggs,
            topNotionalStrikes=[]
        )
