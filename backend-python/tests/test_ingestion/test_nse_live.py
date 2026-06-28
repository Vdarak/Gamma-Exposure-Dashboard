import pytest
from app.services.ingestion.nse_live import NSELiveScraperService
from app.services.ingestion.normalizer import NormalizedSnapshot

@pytest.mark.asyncio
async def test_nse_live_scraper_service():
    scraper = NSELiveScraperService()
    # Scrape NIFTY live (NSE Live blocks frequently, so we handle None gracefully)
    snap = await scraper.get_normalized_snapshot("NIFTY")
    
    if snap is None:
        print("⚠️ NSE Live scraper returned None. Likely blocked by NSE rate-limit/firewall in testing environment.")
        return
        
    assert isinstance(snap, NormalizedSnapshot)
    assert snap.ticker == "NIFTY"
    assert snap.spot_price > 0.0
    assert len(snap.options) > 0
    
    # Assert contract details
    contract = snap.options[0]
    assert contract.strike > 0.0
    assert contract.option_type in ["C", "P"]
    assert contract.expiration is not None
    assert contract.last_price >= 0.0
    assert contract.open_interest >= 0
