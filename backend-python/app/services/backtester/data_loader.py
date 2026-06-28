import os
import glob
import logging
from pathlib import Path
from datetime import datetime, date
import duckdb
from app.config import settings

logger = logging.getLogger("gamma-exposure-backend.backtester.data_loader")

class DuckDBDataLoader:
    """
    DuckDB-powered EOD and Intraday data loader.
    Replicates TypeScript's outlier wick-cleaning and time-bucket aggregation.
    """
    def __init__(self, data_dir: str = None):
        self.data_dir = Path(data_dir or settings.data_dir)
        self.raw_dir = self.data_dir / "alpha_vantage" / "raw"
        self.parquet_dir = self.data_dir / "alpha_vantage" / "parquet"
        
        # Connect to in-memory DuckDB
        self.conn = duckdb.connect(database=":memory:")
        logger.info(f"Initialized DuckDBDataLoader with data_dir: {self.data_dir}")

    def query(self, sql: str, params: list = None) -> list[dict]:
        """Execute a DuckDB query and return results as list of dicts."""
        res = self.conn.execute(sql, params or [])
        cols = [desc[0] for desc in res.description]
        return [dict(zip(cols, row)) for row in res.fetchall()]

    def has_parquet_files(self, dir_path: Path) -> bool:
        if not dir_path.exists():
            return False
        return len(list(dir_path.glob("*.parquet"))) > 0

    def get_valid_data_files(self, dir_path: Path, ext: str) -> list[str]:
        if not dir_path.exists():
            return []
        files = dir_path.glob(f"*{ext}")
        return [str(f) for f in files if f.name.endswith(ext) and not f.name.startswith(".")]

    def get_available_tickers(self) -> list[str]:
        """Scan folders to find tickers with daily or intraday historical data."""
        tickers = set()

        # 1. Raw Daily
        raw_daily = self.raw_dir / "equities" / "daily_adjusted"
        if raw_daily.exists():
            for f in raw_daily.glob("*.csv"):
                if not f.name.startswith("."):
                    tickers.add(f.stem)

        # 2. Parquet Daily
        parquet_daily = self.parquet_dir / "equities" / "daily_adjusted"
        if parquet_daily.exists():
            for f in parquet_daily.glob("*.parquet"):
                if not f.name.startswith("."):
                    tickers.add(f.stem)

        # 3. Raw Intraday
        raw_intra = self.raw_dir / "equities" / "intraday"
        if raw_intra.exists():
            for f in raw_intra.iterdir():
                if f.is_dir() and not f.name.startswith("."):
                    tickers.add(f.name)

        # 4. Parquet Intraday
        parquet_intra = self.parquet_dir / "equities" / "intraday"
        if parquet_intra.exists():
            for f in parquet_intra.iterdir():
                if f.is_dir() and not f.name.startswith("."):
                    tickers.add(f.name)

        return sorted(list(tickers))

    def get_ticker_date_range(self, ticker: str) -> dict:
        """Get available min and max date range for a ticker."""
        t = ticker.upper()
        
        # Paths for daily
        parquet_path = self.parquet_dir / "equities" / "daily_adjusted" / f"{t}.parquet"
        csv_path = self.raw_dir / "equities" / "daily_adjusted" / f"{t}.csv"
        
        source_arg = ""
        read_func = ""
        
        if parquet_path.exists() and not parquet_path.name.startswith("._"):
            source_arg = f"'{parquet_path}'"
            read_func = "read_parquet"
        elif csv_path.exists() and not csv_path.name.startswith("._"):
            source_arg = f"'{csv_path}'"
            read_func = "read_csv_auto"
        else:
            # Check intraday 1min files
            parquet_dir = self.parquet_dir / "equities" / "intraday" / t / "1min"
            csv_dir = self.raw_dir / "equities" / "intraday" / t / "1min"
            
            p_files = self.get_valid_data_files(parquet_dir, ".parquet")
            c_files = self.get_valid_data_files(csv_dir, ".csv")
            
            if p_files:
                source_arg = "[" + ", ".join(f"'{f}'" for f in p_files) + "]"
                read_func = "read_parquet"
            elif c_files:
                source_arg = "[" + ", ".join(f"'{f}'" for f in c_files) + "]"
                read_func = "read_csv_auto"

        if not source_arg:
            raise FileNotFoundError(f"No historical daily/intraday data found for ticker {t}.")

        sql = f"""
            SELECT 
                MIN(timestamp)::VARCHAR as min_date,
                MAX(timestamp)::VARCHAR as max_date
            FROM {read_func}({source_arg})
        """
        try:
            res = self.query(sql)
            if res and res[0]["min_date"] and res[0]["max_date"]:
                min_date = res[0]["min_date"].split(" ")[0].split("T")[0]
                max_date = res[0]["max_date"].split(" ")[0].split("T")[0]
                return {"minDate": min_date, "maxDate": max_date}
        except Exception as e:
            logger.error(f"Error querying date range for {t}: {e}")
            
        return {"minDate": "2020-01-01", "maxDate": "2023-12-31"}

    def load_historical_data(self, ticker: str, timeframe: str, start_date: str, end_date: str) -> list[dict]:
        """
        Load price bars for backtesting.
        Performs session hours filtering and outlier wick cleaning.
        """
        t = ticker.upper()
        
        if timeframe == "1d":
            # ─── DAILY TIMEFRAME ───
            parquet_path = self.parquet_dir / "equities" / "daily_adjusted" / f"{t}.parquet"
            csv_path = self.raw_dir / "equities" / "daily_adjusted" / f"{t}.csv"
            
            source_arg = ""
            read_func = ""
            
            if parquet_path.exists() and not parquet_path.name.startswith("._"):
                source_arg = f"'{parquet_path}'"
                read_func = "read_parquet"
            elif csv_path.exists() and not csv_path.name.startswith("._"):
                source_arg = f"'{csv_path}'"
                read_func = "read_csv_auto"
            else:
                raise FileNotFoundError(f"No daily historical data found for ticker {t}.")
                
            sql = f"""
                SELECT 
                    timestamp::VARCHAR as timestamp,
                    open::DOUBLE as open,
                    high::DOUBLE as high,
                    low::DOUBLE as low,
                    adjusted_close::DOUBLE as close,
                    volume::DOUBLE as volume
                FROM {read_func}({source_arg})
                WHERE timestamp >= '{start_date}' AND timestamp <= '{end_date}'
                ORDER BY timestamp ASC
            """
            
            results = self.query(sql)
            return [
                {
                    "timestamp": r["timestamp"].split(" ")[0],
                    "open": r["open"],
                    "high": r["high"],
                    "low": r["low"],
                    "close": r["close"],
                    "volume": r["volume"]
                }
                for r in results
            ]
            
        else:
            # ─── INTRADAY TIMEFRAME ───
            parquet_dir = self.parquet_dir / "equities" / "intraday" / t / "1min"
            csv_dir = self.raw_dir / "equities" / "intraday" / t / "1min"
            
            p_files = self.get_valid_data_files(parquet_dir, ".parquet")
            c_files = self.get_valid_data_files(csv_dir, ".csv")
            
            source_arg = ""
            read_func = ""
            
            if p_files:
                source_arg = "[" + ", ".join(f"'{f}'" for f in p_files) + "]"
                read_func = "read_parquet"
            elif c_files:
                source_arg = "[" + ", ".join(f"'{f}'" for f in c_files) + "]"
                read_func = "read_csv_auto"
            else:
                raise FileNotFoundError(f"No 1-minute intraday data found for ticker {t}.")
                
            # Determine timeframe minutes
            agg_minutes = 1
            if timeframe == "5m":
                agg_minutes = 5
            elif timeframe == "15m":
                agg_minutes = 15
            elif timeframe == "30m":
                agg_minutes = 30
            elif timeframe == "1h":
                agg_minutes = 60
                
            # Market session hours
            is_india = t in ["NIFTY", "BANKNIFTY", "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN"] or t.endswith(".NS")
            market_start = "09:15:00" if is_india else "09:30:00"
            market_end = "15:30:00" if is_india else "16:00:00"
            
            if agg_minutes == 1:
                # 1m bars with wick cleaning
                sql = f"""
                    SELECT 
                        timestamp::VARCHAR as timestamp,
                        open::DOUBLE as open,
                        CASE 
                            WHEN CAST(timestamp AS TIME) = TIME '{market_end}' THEN greatest(open::DOUBLE, close::DOUBLE)
                            WHEN (high::DOUBLE - greatest(open::DOUBLE, close::DOUBLE)) / close::DOUBLE > 0.015 
                                THEN greatest(open::DOUBLE, close::DOUBLE) + 0.001 * close::DOUBLE
                            ELSE high::DOUBLE
                        END as high,
                        CASE 
                            WHEN CAST(timestamp AS TIME) = TIME '{market_end}' THEN least(open::DOUBLE, close::DOUBLE)
                            WHEN (least(open::DOUBLE, close::DOUBLE) - low::DOUBLE) / close::DOUBLE > 0.015 
                                THEN least(open::DOUBLE, close::DOUBLE) - 0.001 * close::DOUBLE
                            ELSE low::DOUBLE
                        END as low,
                        close::DOUBLE as close,
                        volume::DOUBLE as volume
                    FROM {read_func}({source_arg})
                    WHERE timestamp >= '{start_date} 00:00:00' AND timestamp <= '{end_date} 23:59:59'
                      AND CAST(timestamp AS TIME) >= TIME '{market_start}'
                      AND CAST(timestamp AS TIME) <= TIME '{market_end}'
                    ORDER BY timestamp ASC
                """
            else:
                # Aggregated bars with wick cleaning applied to 1m components
                sql = f"""
                    WITH cleaned_raw AS (
                        SELECT 
                            timestamp,
                            open::DOUBLE as open,
                            close::DOUBLE as close,
                            volume::DOUBLE as volume,
                            CASE 
                                WHEN CAST(timestamp AS TIME) = TIME '{market_end}' THEN greatest(open::DOUBLE, close::DOUBLE)
                                WHEN (high::DOUBLE - greatest(open::DOUBLE, close::DOUBLE)) / close::DOUBLE > 0.015 
                                    THEN greatest(open::DOUBLE, close::DOUBLE) + 0.001 * close::DOUBLE
                                ELSE high::DOUBLE
                            END as high,
                            CASE 
                                WHEN CAST(timestamp AS TIME) = TIME '{market_end}' THEN least(open::DOUBLE, close::DOUBLE)
                                WHEN (least(open::DOUBLE, close::DOUBLE) - low::DOUBLE) / close::DOUBLE > 0.015 
                                    THEN least(open::DOUBLE, close::DOUBLE) - 0.001 * close::DOUBLE
                                ELSE low::DOUBLE
                            END as low
                        FROM {read_func}({source_arg})
                        WHERE timestamp >= '{start_date} 00:00:00' AND timestamp <= '{end_date} 23:59:59'
                          AND CAST(timestamp AS TIME) >= TIME '{market_start}'
                          AND CAST(timestamp AS TIME) <= TIME '{market_end}'
                    ),
                    grouped_bars AS (
                        SELECT 
                            time_bucket(INTERVAL '{agg_minutes} minutes', timestamp) AS bucket_time,
                            timestamp,
                            open,
                            high,
                            low,
                            close,
                            volume
                        FROM cleaned_raw
                    )
                    SELECT 
                        bucket_time::VARCHAR as timestamp,
                        arg_min(open, timestamp)::DOUBLE as open,
                        MAX(high)::DOUBLE as high,
                        MIN(low)::DOUBLE as low,
                        arg_max(close, timestamp)::DOUBLE as close,
                        SUM(volume)::DOUBLE as volume
                    FROM grouped_bars
                    GROUP BY bucket_time
                    ORDER BY bucket_time ASC
                """
                
            results = self.query(sql)
            return [
                {
                    "timestamp": r["timestamp"],
                    "open": r["open"],
                    "high": r["high"],
                    "low": r["low"],
                    "close": r["close"],
                    "volume": r["volume"]
                }
                for r in results
            ]

    def load_benchmark_data(self, ticker: str, start_date: str, end_date: str) -> list[dict]:
        """
        Loads daily closing prices for the benchmark.
        Falls back to yfinance if local parquet/CSV file is not found.
        """
        t = ticker.upper()
        
        # 1. Try local storage first
        try:
            return self.load_historical_data(t, "1d", start_date, end_date)
        except FileNotFoundError:
            logger.info(f"Local benchmark data for {t} not found. Fetching from yfinance...")
            
        # 2. Fall back to yfinance
        try:
            import yfinance as yf
            df = yf.download(t, start=start_date, end=end_date, progress=False)
            if df.empty:
                raise ValueError(f"No yfinance data found for benchmark {t}")
            
            # Flatten multiindex columns if present
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
                
            df = df.reset_index()
            res = []
            for _, row in df.iterrows():
                dt = row["Date"]
                if hasattr(dt, "strftime"):
                    date_str = dt.strftime("%Y-%m-%d")
                else:
                    date_str = str(dt).split(" ")[0]
                
                # Fetch columns (safely unpack single-values from pandas Series if multiindex residual)
                def get_float(val):
                    if hasattr(val, "iloc"):
                        return float(val.iloc[0])
                    return float(val) if pd.notna(val) else 0.0

                close_val = get_float(row.get("Close", row.get("Adj Close", 0)))
                open_val = get_float(row.get("Open", 0))
                high_val = get_float(row.get("High", 0))
                low_val = get_float(row.get("Low", 0))
                vol_val = get_float(row.get("Volume", 0))
                
                res.append({
                    "timestamp": date_str,
                    "open": open_val,
                    "high": high_val,
                    "low": low_val,
                    "close": close_val,
                    "volume": vol_val
                })
            return res
        except Exception as e:
            logger.error(f"Failed to fetch benchmark {t} from yfinance: {e}")
            dates = pd.date_range(start=start_date, end=end_date, freq='B')
            return [
                {
                    "timestamp": d.strftime("%Y-%m-%d"),
                    "open": 100.0,
                    "high": 100.0,
                    "low": 100.0,
                    "close": 100.0,
                    "volume": 0.0
                }
                for d in dates
            ]
