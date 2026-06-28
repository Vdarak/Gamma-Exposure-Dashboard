import csv
import httpx
import logging
import zipfile
import io
import os
from datetime import datetime, date
from typing import Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert
from app.models.quant import CotPosition

logger = logging.getLogger("gamma-exposure-backend.cot")

COT_MARKET_MAP = {
    'SPX': 'E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE',
    'NDX': 'NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE',
    'GLD': 'GOLD - COMMODITY EXCHANGE INC.',
    'SLV': 'SILVER - COMMODITY EXCHANGE INC.',
    'USO': 'WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE',
    'TNX': 'UST 10Y NOTE - CHICAGO BOARD OF TRADE',
    'DXY': 'USD INDEX - ICE FUTURES U.S.',
    'IWM': 'RUSSELL E-MINI - CHICAGO MERCANTILE EXCHANGE'
}

class CotIngestionService:
    """
    CFTC Commitment of Traders (COT) positioning data ingestion service.
    Downloads weekly reports and seeds historical data.
    """
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def ingest_cot_data(self) -> bool:
        """
        Ingests the latest weekly CFTC COT positioning data.
        """
        logger.info("Starting CFTC COT weekly positioning data ingestion...")
        
        # 1. Attempt historical seeding if database has very few records
        try:
            await self.seed_historical_cot()
        except Exception as e:
            logger.warning(f"Failed to seed historical COT data: {e}")

        # 2. Fetch the latest weekly report
        url = 'https://www.cftc.gov/dea/newcot/deafut.txt'
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.get(url, headers=headers)
                
            if res.status_code != 200 or not res.text:
                logger.error(f"Failed to download COT file: HTTP {res.status_code}")
                return False

            rows_written = await self._parse_and_save_cot_rows(res.text)
            logger.info(f"CFTC COT weekly ingestion complete: successfully updated {rows_written} records.")
            return True
            
        except Exception as e:
            logger.error(f"Failed to ingest weekly COT data: {e}")
            return False

    async def seed_historical_cot(self) -> bool:
        """
        Checks if historical COT data is populated. If not, downloads historical archives
        and seeds the database.
        """
        count_stmt = select(func.count(CotPosition.id))
        count_res = await self.db.execute(count_stmt)
        count = count_res.scalar() or 0

        # Skip if we already have sufficient history seeded
        if count > 400:
            logger.info("Historical COT data already exists. Skipping seed.")
            return True

        logger.info("Historical COT data is empty or insufficient. Initializing historical seed...")
        
        years = [2025, 2026]
        total_processed = 0
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            for year in years:
                url = f"https://www.cftc.gov/files/dea/history/deacot{year}.zip"
                logger.info(f"Downloading historical ZIP for {year} from {url}...")
                
                try:
                    res = await client.get(url, headers=headers)
                    if res.status_code != 200:
                        logger.error(f"Failed to download {year} ZIP: HTTP {res.status_code}")
                        continue
                        
                    # Extract zip file in memory
                    zip_file = zipfile.ZipFile(io.BytesIO(res.content))
                    
                    # Find and read the main text file (typically annual.txt or similar)
                    target_filename = None
                    for name in zip_file.namelist():
                        if name.endswith('.txt') or name.lower() == 'annual.txt':
                            target_filename = name
                            break
                            
                    if not target_filename:
                        logger.error(f"No suitable text file found in extracted ZIP for {year}")
                        continue

                    # Read txt contents
                    content = zip_file.read(target_filename).decode('utf-8', errors='ignore')
                    year_processed = await self._parse_and_save_cot_rows(content)
                    
                    logger.info(f"Loaded {year_processed} records for historical year {year}")
                    total_processed += year_processed
                    
                except Exception as e:
                    logger.error(f"Failed to seed historical year {year}: {e}")
                    raise e
                    
        logger.info(f"Historical COT Seeding complete: successfully loaded {total_processed} total records.")
        return True

    async def _parse_and_save_cot_rows(self, raw_txt: str) -> int:
        """
        Parses raw CFTC csv content and upserts matching market rows to PostgreSQL.
        """
        lines = raw_txt.splitlines()
        if not lines:
            return 0

        # Parse CSV line-by-line using standard CSV reader
        reader = csv.reader(lines, delimiter=',', skipinitialspace=True)
        processed_count = 0

        for cols in reader:
            if len(cols) < 17:
                continue
                
            # Header line check
            if cols[0] == 'Market and Exchange Names' or cols[0] == 'Market_and_Market_Type':
                continue

            market_name = cols[0].strip()

            # Find matching ticker
            ticker = None
            for key, val in COT_MARKET_MAP.items():
                if val.lower() == market_name.lower():
                    ticker = key
                    break

            if not ticker:
                continue

            try:
                report_date_str = cols[2].strip()
                report_date = datetime.strptime(report_date_str, "%Y-%m-%d").date()
                
                open_interest = int(cols[7]) if cols[7] else 0
                noncomm_long = int(cols[8]) if cols[8] else 0
                noncomm_short = int(cols[9]) if cols[9] else 0
                comm_long = int(cols[11]) if cols[11] else 0
                comm_short = int(cols[12]) if cols[12] else 0
                retail_long = int(cols[15]) if cols[15] else 0
                retail_short = int(cols[16]) if cols[16] else 0

                stmt = insert(CotPosition).values(
                    ticker=ticker,
                    report_date=report_date,
                    open_interest=open_interest,
                    noncomm_long=noncomm_long,
                    noncomm_short=noncomm_short,
                    comm_long=comm_long,
                    comm_short=comm_short,
                    retail_long=retail_long,
                    retail_short=retail_short
                ).on_conflict_do_update(
                    index_elements=["ticker", "report_date"],
                    set_={
                        "open_interest": open_interest,
                        "noncomm_long": noncomm_long,
                        "noncomm_short": noncomm_short,
                        "comm_long": comm_long,
                        "comm_short": comm_short,
                        "retail_long": retail_long,
                        "retail_short": retail_short
                    }
                )
                await self.db.execute(stmt)
                processed_count += 1
                
            except Exception as e:
                # Log parsing errors but keep processing other rows
                logger.debug(f"Parsing error on COT row: {e}")
                continue

        await self.db.commit()
        return processed_count

    async def get_historical_cot(self, ticker: str, limit: int = 104) -> List[Dict[str, Any]]:
        """
        Retrieves historical COT reports for a macro ticker.
        Computes net positioning for commercial, speculative, and retail traders.
        """
        t = ticker.upper()
        stmt = (
            select(CotPosition)
            .where(CotPosition.ticker == t)
            .order_by(CotPosition.report_date.asc())
            .limit(limit)
        )
        res = await self.db.execute(stmt)
        rows = res.scalars().all()
        
        result = []
        for row in rows:
            c_long = int(row.comm_long)
            c_short = int(row.comm_short)
            nc_long = int(row.noncomm_long)
            nc_short = int(row.noncomm_short)
            r_long = int(row.retail_long)
            r_short = int(row.retail_short)
            
            result.append({
                "reportDate": row.report_date.isoformat(),
                "openInterest": int(row.open_interest),
                "commLong": c_long,
                "commShort": c_short,
                "commNet": c_long - c_short,
                "noncommLong": nc_long,
                "noncommShort": nc_short,
                "noncommNet": nc_long - nc_short,
                "retailLong": r_long,
                "retailShort": r_short,
                "retailNet": r_long - r_short
            })
            
        return result
