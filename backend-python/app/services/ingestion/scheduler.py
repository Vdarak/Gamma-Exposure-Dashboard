import logging
import asyncio
from datetime import datetime, date
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.config import settings
from app.database import AsyncSessionLocal
from app.utils.market_hours import is_us_market_open, is_india_market_open

# Import scrapers and services
from app.services.ingestion.cboe import CBOEScraperService
from app.services.ingestion.nse_live import NSELiveScraperService
from app.services.ingestion.yahoo import YahooFinanceService
from app.services.ingestion.cot import CotIngestionService
from app.services.ingestion.jugaad import JugaadDataService
from app.services.ingestion.saver import DataSaverService

logger = logging.getLogger("gamma-exposure-backend.scheduler")

class IngestionScheduler:
    """
    APScheduler manager for all quant and options data ingestion tasks.
    """
    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.cboe_scraper = CBOEScraperService()
        self.nse_scraper = NSELiveScraperService()

    def start(self):
        """
        Start scheduling all tasks.
        """
        logger.info("Initializing Ingestion Scheduler...")
        
        # 1. Option Snapshots Scraping (Every 5 minutes, checks market hours inside)
        self.scheduler.add_job(
            self.collect_live_data,
            "cron",
            minute="*/5",
            id="collect_live_data_job"
        )
        logger.info("Scheduled Option Snapshots: every 5 minutes")

        # 2. Risk-free rates update (At 3 AM, 10 AM, 1 PM, 8 PM UTC daily)
        self.scheduler.add_job(
            self.update_interest_rates,
            "cron",
            hour="3,10,13,20",
            minute="0",
            id="update_interest_rates_job"
        )
        logger.info("Scheduled Interest Rates: daily at 03:00, 10:00, 13:00, 20:00 UTC")

        # 3. Weekly CFTC COT report updates (Every Saturday at 4 AM UTC)
        self.scheduler.add_job(
            self.update_cot_data,
            "cron",
            day_of_week="sat",
            hour="4",
            minute="0",
            id="update_cot_data_job"
        )
        logger.info("Scheduled CFTC COT Report: weekly on Saturdays at 04:00 UTC")

        # 4. India daily EOD data collection (Every Mon-Fri at 3:45 PM IST -> 10:15 AM UTC)
        # Note: APScheduler handles local timezone of the machine or UTC. We will use UTC cron to be safe.
        # 3:45 PM IST is 10:15 AM UTC.
        self.scheduler.add_job(
            self.collect_india_daily_eod,
            "cron",
            day_of_week="mon-fri",
            hour="10",
            minute="15",
            id="collect_india_daily_eod_job"
        )
        logger.info("Scheduled Indian Market EOD: Mon-Fri at 15:45 IST (10:15 UTC)")

        # 5. US daily spot history collection (Every Mon-Fri at 4:30 PM EST -> 9:30 PM UTC / 8:30 PM UTC DST)
        # 4:30 PM EST is 9:30 PM UTC.
        self.scheduler.add_job(
            self.collect_us_daily_eod,
            "cron",
            day_of_week="mon-fri",
            hour="21",
            minute="30",
            id="collect_us_daily_eod_job"
        )
        logger.info("Scheduled US Market EOD: Mon-Fri at 16:30 EST (21:30 UTC)")

        self.scheduler.start()
        logger.info("Ingestion Scheduler successfully started.")

    # ── Job Implementations with database session encapsulation ──

    async def collect_live_data(self):
        """Job to collect live options chain data if markets are open."""
        try:
            us_open = is_us_market_open()
            ind_open = is_india_market_open()
            
            if not us_open and not ind_open:
                logger.info("⏸️ No markets open, skipping live collection.")
                return

            async with AsyncSessionLocal() as session:
                saver = DataSaverService(session)
                
                # US Market Collection
                if us_open:
                    tickers = settings.US_TICKERS.split(",")
                    logger.info(f"🇺🇸 US Market is open. Collecting for {tickers}...")
                    for ticker in tickers:
                        try:
                            snap = await self.cboe_scraper.get_normalized_snapshot(ticker.strip())
                            if snap:
                                await saver.save_snapshot(snap)
                        except Exception as e:
                            logger.error(f"Error collecting US data for {ticker}: {e}")

                # Indian Market Collection
                if ind_open:
                    tickers = settings.INDIA_TICKERS.split(",")
                    logger.info(f"🇮🇳 Indian Market is open. Collecting for {tickers}...")
                    for ticker in tickers:
                        try:
                            snap = await self.nse_scraper.get_normalized_snapshot(ticker.strip())
                            if snap:
                                await saver.save_snapshot(snap)
                        except Exception as e:
                            logger.error(f"Error collecting India data for {ticker}: {e}")
        except Exception as e:
            logger.error(f"Critical error in collect_live_data job: {e}")

    async def update_interest_rates(self):
        """Job to update macro risk-free interest rates."""
        logger.info("⏰ Starting scheduled interest rates update...")
        async with AsyncSessionLocal() as session:
            try:
                yahoo = YahooFinanceService(session)
                rates = await yahoo.update_risk_free_rates()
                logger.info(f"✅ Stored rates: US={rates['us_rate']*100:.2f}%, India={rates['india_rate']*100:.2f}%")
            except Exception as e:
                logger.error(f"Error updating interest rates: {e}")

    async def update_cot_data(self):
        """Job to fetch CFTC COT weekly report."""
        logger.info("⏰ Starting scheduled COT data ingestion...")
        async with AsyncSessionLocal() as session:
            try:
                cot = CotIngestionService(session)
                success = await cot.ingest_latest_cot()
                if success:
                    logger.info("✅ COT report successfully ingested.")
            except Exception as e:
                logger.error(f"Error ingesting COT report: {e}")

    async def collect_india_daily_eod(self):
        """Job to collect India daily stock histories and F&O bhavcopies."""
        logger.info("⏰ Starting scheduled India daily EOD data collection...")
        today = date.today()
        async with AsyncSessionLocal() as session:
            try:
                jugaad = JugaadDataService(session)
                
                # Fetch F&O Bhavcopy
                fo_rows = await jugaad.fetch_and_store_fo_bhavcopy(today)
                logger.info(f"✅ Ingested {fo_rows} F&O contract records for {today}")
                
                # Fetch Equity histories
                tickers = settings.INDIA_TICKERS.split(",")
                for ticker in tickers:
                    eq_rows = await jugaad.fetch_and_store_equity(ticker.strip(), today, today)
                    logger.info(f"✅ Ingested {eq_rows} equity daily record for {ticker.strip()}")
                    
            except Exception as e:
                logger.error(f"Error collecting India daily EOD data: {e}")

    async def collect_us_daily_eod(self):
        """Job to collect US spot histories (essential for daily GARCH)."""
        logger.info("⏰ Starting scheduled US daily EOD data collection...")
        async with AsyncSessionLocal() as session:
            try:
                yahoo = YahooFinanceService(session)
                tickers = settings.US_TICKERS.split(",")
                for ticker in tickers:
                    rows = await yahoo.fetch_and_store_spot_history(ticker.strip(), days=2)
                    logger.info(f"✅ Ingested {rows} spot history record for {ticker.strip()}")
            except Exception as e:
                logger.error(f"Error collecting US spot histories: {e}")
