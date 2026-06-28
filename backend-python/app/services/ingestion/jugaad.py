from datetime import date, datetime, timedelta
import pandas as pd
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from jugaad_data.nse import stock_df, derivatives_df, bhavcopy_fo_save, NSELive
from app.models.quant import IndiaEquityDaily, IndiaFoDaily
from app.config import settings

class JugaadDataService:
    """
    India market EOD and historical data ingestion service using the jugaad-data library.
    """
    BHAVCOPY_DIR = Path(settings.model_storage_path) / "bhavcopy"
    PARQUET_DIR = Path(settings.model_storage_path) / "parquet"

    def __init__(self, db_session: AsyncSession):
        self.db = db_session
        self.live = NSELive()
        self.BHAVCOPY_DIR.mkdir(parents=True, exist_ok=True)
        self.PARQUET_DIR.mkdir(parents=True, exist_ok=True)

    async def fetch_and_store_equity(self, symbol: str, from_date: date, to_date: date) -> int:
        """
        Fetch historical stock/index EOD data and store it in PostgreSQL + Parquet.
        """
        # jugaad-data fetches stock daily data
        # Note: stock_df is synchronous since it uses urllib/requests internally, so we run in threadpool or call directly
        # since it's a EOD fetch, calling directly is fine.
        try:
            df = stock_df(symbol=symbol, from_date=from_date, to_date=to_date, series="EQ")
        except Exception as e:
            print(f"Error fetching stock_df for {symbol}: {e}")
            return 0
            
        if df.empty:
            return 0

        # Store in PostgreSQL
        rows_inserted = 0
        for _, row in df.iterrows():
            # Convert timestamp which might be string, date, or pd.Timestamp to python date
            ts = row['DATE']
            if isinstance(ts, str):
                trade_date = datetime.strptime(ts, "%Y-%m-%d").date()
            elif hasattr(ts, 'date'):
                trade_date = ts.date()
            else:
                trade_date = ts

            stmt = insert(IndiaEquityDaily).values(
                symbol=symbol,
                series=row.get('SERIES', 'EQ'),
                date=trade_date,
                open=row.get('OPEN'),
                high=row.get('HIGH'),
                low=row.get('LOW'),
                close=row.get('CLOSE'),
                last_traded=row.get('LTP'),
                prev_close=row.get('PREV. CLOSE'),
                volume=int(row.get('VOLUME', 0)) if pd.notna(row.get('VOLUME')) else 0,
                traded_value=row.get('VALUE'),
                total_trades=int(row.get('NO OF TRADES', 0)) if pd.notna(row.get('NO OF TRADES')) else 0,
                vwap=row.get('VWAP'),
                delivery_qty=int(row.get('DELIVERY QTY', 0)) if pd.notna(row.get('DELIVERY QTY')) else 0,
                delivery_pct=row.get('DELIVERY %')
            )

            # Upsert on conflict
            stmt = stmt.on_conflict_do_update(
                index_elements=["ticker", "timestamp"],
                set_={
                    "open": stmt.excluded.open,
                    "high": stmt.excluded.high,
                    "low": stmt.excluded.low,
                    "close": stmt.excluded.close,
                    "volume": stmt.excluded.volume,
                    "vwap": stmt.excluded.vwap,
                    "delivery_qty": stmt.excluded.delivery_qty,
                    "delivery_pct": stmt.excluded.delivery_pct
                }
            )
            await self.db.execute(stmt)
            rows_inserted += 1

        await self.db.commit()

        # Save to Parquet for VectorBT
        parquet_path = self.PARQUET_DIR / f"{symbol}_equity_daily.parquet"
        df.to_parquet(parquet_path, index=False)

        return rows_inserted

    async def fetch_and_store_fo_bhavcopy(self, trading_date: date) -> int:
        """
        Download daily F&O bhavcopy zip, extract, parse, and store all contracts in PostgreSQL.
        """
        try:
            # bhavcopy_fo_save is synchronous, downloads zip to directory
            bhavcopy_fo_save(trading_date, str(self.BHAVCOPY_DIR))
        except Exception as e:
            print(f"Bhavcopy F&O not available for {trading_date}: {e}")
            return 0

        # filename format from jugaad-data: foDDMMYYYY.csv
        csv_path = self.BHAVCOPY_DIR / f"fo{trading_date.strftime('%d%m%Y')}.csv"
        if not csv_path.exists():
            return 0

        # Read CSV
        df = pd.read_csv(csv_path)
        if df.empty:
            return 0

        # Strip spaces in columns
        df.columns = [c.strip() for c in df.columns]

        # Insert contracts
        rows_inserted = 0
        for _, row in df.iterrows():
            # Filter only indices and options/futures we track to prevent DB bloat
            sym = row['SYMBOL'].strip()
            if sym not in settings.INDIA_TICKERS.split(','):
                continue

            # Convert date strings
            exp_str = row['EXPIRY_DT'].strip()
            exp_date = datetime.strptime(exp_str, "%d-%b-%Y").date()

            opt_type = row['OPTION_TYP'].strip()
            if opt_type == 'XX':
                opt_type = None  # Futures

            stmt = insert(IndiaFoDaily).values(
                symbol=sym,
                instrument=row['INSTRUMENT'].strip(),
                date=trading_date,
                expiry_date=exp_date,
                strike_price=row['STRIKE_PR'],
                option_type=opt_type,
                open=row['OPEN'],
                high=row['HIGH'],
                low=row['LOW'],
                close=row['CLOSE'],
                settle_price=row['SETTLE_PR'],
                volume=int(row['CONTRACTS']) if pd.notna(row['CONTRACTS']) else 0,
                traded_value=row['VAL_INLAKH'] * 100000.0 if pd.notna(row['VAL_INLAKH']) else 0.0, # convert Lakhs to absolute Rupees
                open_interest=int(row['OPEN_INT']) if pd.notna(row['OPEN_INT']) else 0,
                change_in_oi=int(row['CHG_IN_OI']) if pd.notna(row['CHG_IN_OI']) else 0,
                market_lot=int(row['MARKET_LOT']) if pd.notna(row['MARKET_LOT']) else 1
            )

            stmt = stmt.on_conflict_do_update(
                index_elements=["ticker", "timestamp", "expiry", "strike_price", "option_type"],
                set_={
                    "open": stmt.excluded.open,
                    "high": stmt.excluded.high,
                    "low": stmt.excluded.low,
                    "close": stmt.excluded.close,
                    "settle_price": stmt.excluded.settle_price,
                    "volume": stmt.excluded.volume,
                    "open_interest": stmt.excluded.open_interest,
                    "change_in_oi": stmt.excluded.change_in_oi
                }
            )
            await self.db.execute(stmt)
            rows_inserted += 1

        await self.db.commit()

        # Cleanup CSV to save space
        try:
            csv_path.unlink()
        except OSError:
            pass

        return rows_inserted

    async def backfill_historical_data(self, symbol: str, years: int = 1):
        """
        Backfill historical daily equity and F&O data.
        """
        end = date.today()
        start = end - timedelta(days=365 * years)
        
        # 1. Fetch equity
        print(f"Backfilling equity for {symbol} from {start} to {end}...")
        eq_count = await self.fetch_and_store_equity(symbol, start, end)
        print(f"Equity backfill completed: {eq_count} records saved.")

        # 2. Fetch F&O Bhavcopies for dates
        print(f"Backfilling F&O bhavcopies for last 30 trading days...")
        fo_count = 0
        for i in range(30):
            d = end - timedelta(days=i)
            if d.weekday() < 5:  # Monday-Friday
                fo_count += await self.fetch_and_store_fo_bhavcopy(d)
        print(f"F&O backfill completed: {fo_count} records saved.")
