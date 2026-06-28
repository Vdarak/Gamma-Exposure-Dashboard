import pytest
from app.services.ingestion.cboe import CBOEScraperService
from app.services.ingestion.normalizer import NormalizedSnapshot

@pytest.mark.asyncio
async def test_cboe_scraper_service():
    scraper = CBOEScraperService()
    # Scrape TSLA (Tesla is liquid and should have options)
    snap = await scraper.get_normalized_snapshot("TSLA")
    
    assert snap is not None
    assert isinstance(snap, NormalizedSnapshot)
    assert snap.ticker == "TSLA"
    assert snap.spot_price > 0.0
    assert len(snap.options) > 0
    
    # Assert contract details
    contract = snap.options[0]
    assert contract.strike > 0.0
    assert contract.option_type in ["C", "P"]
    assert contract.expiration is not None
    assert contract.last_price >= 0.0
    assert contract.open_interest >= 0
