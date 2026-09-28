import logging
import asyncio
from datetime import datetime, date
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.config import settings, is_enabled
from app.database import AsyncSessionLocal
from app.utils.market_hours import is_us_market_open, is_india_market_open

# Import scrapers and services
from app.services.ingestion.cboe import CBOEScraperService
from app.services.ingestion.dhan_client import DhanOptionChainClient
from app.services.ingestion.nse_live import NSELiveScraperService
from app.services.ingestion.yahoo import YahooFinanceService
from app.services.ingestion.cot import CotIngestionService
from app.services.ingestion.nse_participant import NSEParticipantParser
from app.services.ingestion.saver import DataSaverService
from app.services.auth.dhan_auth import DhanAuthManager

logger = logging.getLogger("gamma-exposure-backend.scheduler")

class IngestionScheduler:
    """
    APScheduler manager for all quant and options data ingestion tasks.
    Configurable via environment variables (accepts ON/OFF, true/false, 1/0).
    """
    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.cboe_scraper = CBOEScraperService()
        self.dhan_client = DhanOptionChainClient()
        self.nse_scraper = NSELiveScraperService()
        self.dhan_auth = DhanAuthManager()

    def start(self):
        """
        Start scheduling all tasks based on individual ON/OFF environment flags.
        """
        logger.info("Initializing Ingestion Scheduler...")
        
        # 1. Option Snapshots Scraping (Every 5 minutes, checks market hours inside)
        if is_enabled(settings.cron_option_snapshots_enabled, default=False):
            self.scheduler.add_job(
                self.collect_live_data,
                "cron",
                minute="*/5",
                id="collect_live_data_job"
            )
            logger.info("✅ Scheduled Option Snapshots: every 5 minutes (ACTIVE)")
        else:
            logger.info("⏸️ Option Snapshots cron job is DISABLED (CRON_OPTION_SNAPSHOTS_ENABLED=OFF)")

        # 2. Risk-free rates update (At 3 AM, 10 AM, 1 PM, 8 PM UTC daily)
        if is_enabled(settings.cron_interest_rates_enabled, default=False):
            self.scheduler.add_job(
                self.update_interest_rates,
                "cron",
                hour="3,10,13,20",
                minute="0",
                id="update_interest_rates_job"
            )
            logger.info("✅ Scheduled Interest Rates: daily at 03:00, 10:00, 13:00, 20:00 UTC (ACTIVE)")
        else:
            logger.info("⏸️ Interest Rates cron job is DISABLED (CRON_INTEREST_RATES_ENABLED=OFF)")

        # 3. Weekly CFTC COT report updates (Every Saturday at 4 AM UTC)
        if is_enabled(settings.cron_cot_report_enabled, default=True):
            self.scheduler.add_job(
                self.update_cot_data,
                "cron",
                day_of_week="sat",
                hour="4",
                minute="0",
                id="update_cot_data_job"
            )
            logger.info("✅ Scheduled CFTC COT Report: weekly on Saturdays at 04:00 UTC (ACTIVE)")
        else:
            logger.info("⏸️ CFTC COT Report cron job is DISABLED (CRON_COT_REPORT_ENABLED=OFF)")

        # 4. NSE Participant-Wise OI (Mon-Fri at 14:45 UTC = 8:15 PM IST)
        if is_enabled(settings.cron_nse_participant_enabled, default=True):
            self.scheduler.add_job(
                self.collect_nse_participant_oi,
                "cron",
                day_of_week="mon-fri",
                hour="14",
                minute="45",
                id="collect_nse_participant_oi_job"
            )
            logger.info("✅ Scheduled NSE Participant OI: Mon-Fri at 20:15 IST (14:45 UTC) (ACTIVE)")
        else:
            logger.info("⏸️ NSE Participant OI cron job is DISABLED (CRON_NSE_PARTICIPANT_ENABLED=OFF)")

        # 5. Dhan Token Renewal (Every 12 hours at 06:00 and 18:00 UTC)
        if is_enabled(settings.cron_dhan_token_renewal_enabled, default=True):
            self.scheduler.add_job(
                self.renew_dhan_token,
                "cron",
                hour="6,18",
                minute="0",
                id="renew_dhan_token_job"
            )
            logger.info("✅ Scheduled Dhan Token Renewal: every 12 hours at 06:00, 18:00 UTC (ACTIVE)")
        else:
            logger.info("⏸️ Dhan Token Renewal cron job is DISABLED (CRON_DHAN_TOKEN_RENEWAL_ENABLED=OFF)")

        # 6. US daily spot history collection (Every Mon-Fri at 4:30 PM EST -> 9:30 PM UTC / 8:30 PM UTC DST)
        if is_enabled(settings.cron_us_eod_enabled, default=False):
            self.scheduler.add_job(
                self.collect_us_daily_eod,
                "cron",
                day_of_week="mon-fri",
                hour="21",
                minute="30",
                id="collect_us_daily_eod_job"
            )
            logger.info("✅ Scheduled US Market EOD: Mon-Fri at 16:30 EST (21:30 UTC) (ACTIVE)")
        else:
            logger.info("⏸️ US Market EOD cron job is DISABLED (CRON_US_EOD_ENABLED=OFF)")

        self.scheduler.start()
        logger.info("Ingestion Scheduler successfully started.")

    # ── Job Implementations with database session encapsulation ──

    async def collect_live_data(self):
        """Job to collect live options chain data if markets are open."""
        try:
            us_enabled = is_enabled(settings.cron_us_options_enabled, default=False)
            india_enabled = is_enabled(settings.cron_india_options_enabled, default=True)

            us_open = is_us_market_open() if us_enabled else False
            ind_open = is_india_market_open() if india_enabled else False
            
            if not us_open and not ind_open:
                logger.info("⏸️ No scheduled markets open or enabled, skipping live collection.")
                return

            async with AsyncSessionLocal() as session:
                saver = DataSaverService(session)
                
                # US Market Collection
                if us_open and us_enabled:
                    tickers = settings.US_TICKERS.split(",")
                    logger.info(f"🇺🇸 US Market is open. Collecting for {tickers}...")
                    for ticker in tickers:
                        try:
                            snap = await self.cboe_scraper.get_normalized_snapshot(ticker.strip())
                            if snap:
                                await saver.save_snapshot(snap)
                        except Exception as e:
                            logger.error(f"Error collecting US data for {ticker}: {e}")

                # Indian Market Collection (Dhan primary, NSE fallback)
                if ind_open and india_enabled:
                    tickers = settings.INDIA_TICKERS.split(",")
                    logger.info(f"🇮🇳 Indian Market is open. Collecting for {tickers}...")
                    for ticker in tickers:
                        ticker = ticker.strip()
                        try:
                            snap = None

                            # Primary: Dhan API (pre-computed Greeks)
                            if settings.dhan_client_id and settings.dhan_access_token:
                                try:
                                    snap = await self.dhan_client.get_normalized_snapshot(ticker)
                                except Exception as dhan_err:
                                    logger.warning(f"Dhan fetch failed for {ticker}: {dhan_err}")

                            # Fallback: NSE direct scraping
                            if snap is None:
                                logger.info(f"[{ticker}] Falling back to NSE direct scraping...")
                                snap = await self.nse_scraper.get_normalized_snapshot(ticker)

                            if snap:
                                await saver.save_snapshot(snap)
                            else:
                                logger.warning(f"[{ticker}] ⚠️ No data from either Dhan or NSE")

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

    async def collect_nse_participant_oi(self):
        """
        Job to fetch NSE Participant-Wise Open Interest data and compute dealer weights.
        Scheduled daily at 8:15 PM IST (14:45 UTC) after NSE publishes the EOD report.
        """
        logger.info("⏰ Starting NSE Participant OI collection...")
        async with AsyncSessionLocal() as session:
            try:
                parser = NSEParticipantParser(session)
                result = await parser.fetch_and_calculate_weights()
                if result:
                    logger.info(
                        "✅ Dealer weights updated: ω_CE=%.4f, ω_PE=%.4f",
                        result["omega_ce"], result["omega_pe"]
                    )
                else:
                    logger.warning("⚠️ NSE participant OI not available (holiday or not yet published)")
            except Exception as e:
                logger.error(f"Error collecting NSE participant OI: {e}")

    async def renew_dhan_token(self):
        """
        Job to renew Dhan access token every 12 hours.
        The token expires after 24 hours, so 12-hour renewal provides safety margin.
        """
        if not settings.dhan_client_id or not settings.dhan_access_token:
            logger.info("⏭️ Dhan credentials not configured, skipping token renewal")
            return

        logger.info("⏰ Starting Dhan token renewal...")
        try:
            new_token = await self.dhan_auth.renew_access_token()
            if new_token:
                # Update the Dhan client's reference
                self.dhan_client = DhanOptionChainClient()
                logger.info("✅ Dhan token renewed and client refreshed")
            else:
                logger.error("❌ Dhan token renewal failed — API access may be lost within 12 hours")
        except Exception as e:
            logger.error(f"Error renewing Dhan token: {e}")

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
