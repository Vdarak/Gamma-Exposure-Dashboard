import yfinance as yf
from datetime import date, datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert
from app.models.quant import InterestRate, SpotPriceHistory
from app.config import settings

class YahooFinanceService:
    """
    US historical data and macro rates updates using yfinance.
    """
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def update_risk_free_rates(self) -> dict:
        """
        Fetch latest US and India bond yields as proxy for risk-free rates.
        """
        us_rate = 0.0525  # 5.25% default
        india_rate = 0.0650  # 6.50% default
        us_source = "Fallback (Assumed)"
        india_source = "Fallback (RBI Benchmark)"

        # 1. Fetch US 3-Month Treasury Bill Yield (^IRX)
        try:
            irx = yf.Ticker("^IRX")
            history = irx.history(period="1d")
            if not history.empty:
                last_price = history["Close"].iloc[-1]
                if last_price > 0:
                    us_rate = float(last_price) / 100.0
                    us_source = f"Yahoo Finance (^IRX: {last_price:.2f}%)"
        except Exception as e:
            print(f"Error fetching US rate from yfinance: {e}")

        # 2. Fetch India 10Y Government Bond Yield (IN10Y.NS)
        try:
            in10y = yf.Ticker("IN10Y.NS")
            history = in10y.history(period="1d")
            if not history.empty:
                last_price = history["Close"].iloc[-1]
                if last_price > 0:
                    india_rate = float(last_price) / 100.0
                    india_source = f"Yahoo Finance (IN10Y.NS: {last_price:.2f}%)"
        except Exception as e:
            print(f"Error fetching India rate from yfinance: {e}")

        # Store US Rate
        stmt_us = insert(InterestRate).values(
            rate_key="US_RISK_FREE",
            rate=us_rate,
            source=us_source,
            updated_at=datetime.now(timezone.utc).replace(tzinfo=None)
        ).on_conflict_do_update(
            index_elements=["rate_key"],
            set_={"rate": us_rate, "source": us_source, "updated_at": datetime.now(timezone.utc).replace(tzinfo=None)}
        )
        await self.db.execute(stmt_us)

        # Store India Rate
        stmt_in = insert(InterestRate).values(
            rate_key="INDIA_RISK_FREE",
            rate=india_rate,
            source=india_source,
            updated_at=datetime.now(timezone.utc).replace(tzinfo=None)
        ).on_conflict_do_update(
            index_elements=["rate_key"],
            set_={"rate": india_rate, "source": india_source, "updated_at": datetime.now(timezone.utc).replace(tzinfo=None)}
        )
        await self.db.execute(stmt_in)
        
        await self.db.commit()

        return {
            "us_rate": us_rate,
            "us_source": us_source,
            "india_rate": india_rate,
            "india_source": india_source
        }

    async def fetch_and_store_spot_history(self, ticker: str, days: int = 30) -> int:
        """
        Fetch EOD historical spot prices and store in spot_price_history (needed for GARCH).
        """
        # Map ticker if index symbol
        yf_ticker = ticker
        if ticker == "SPX":
            yf_ticker = "^SPX"
        elif ticker == "NIFTY":
            yf_ticker = "^NSEI"
        elif ticker == "BANKNIFTY":
            yf_ticker = "^NSEBANK"
            
        try:
            t = yf.Ticker(yf_ticker)
            df = t.history(period=f"{days}d")
        except Exception as e:
            print(f"Error fetching spot history for {ticker}: {e}")
            return 0

        if df.empty:
            return 0

        rows_inserted = 0
        for timestamp, row in df.iterrows():
            ts = timestamp.to_pydatetime()
            spot_price = float(row["Close"])

            stmt = insert(SpotPriceHistory).values(
                ticker=ticker,
                timestamp=ts,
                spot_price=spot_price
            ).on_conflict_do_update(
                constraint="uq_spot_price_history",
                set_={"spot_price": spot_price}
            )
            await self.db.execute(stmt)
            rows_inserted += 1

        await self.db.commit()
        return rows_inserted
