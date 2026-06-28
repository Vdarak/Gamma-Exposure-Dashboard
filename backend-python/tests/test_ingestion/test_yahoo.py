import pytest
from app.services.ingestion.yahoo import YahooFinanceService
from app.models.quant import InterestRate

@pytest.mark.asyncio
async def test_update_risk_free_rates(db_session):
    yahoo = YahooFinanceService(db_session)
    rates = await yahoo.update_risk_free_rates()
    
    # Assert return structure
    assert "us_rate" in rates
    assert "india_rate" in rates
    assert rates["us_rate"] > 0.0
    assert rates["india_rate"] > 0.0
    
    # Assert database storage
    from sqlalchemy import select
    result_us = await db_session.execute(
        select(InterestRate).where(InterestRate.rate_key == "US_RISK_FREE")
    )
    db_us = result_us.scalar_one_or_none()
    assert db_us is not None
    assert float(db_us.rate) == pytest.approx(rates["us_rate"], abs=1e-5)
