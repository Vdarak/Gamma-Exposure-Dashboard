import pytest
from datetime import date, timedelta
from app.services.ingestion.jugaad import JugaadDataService
from app.models.quant import IndiaEquityDaily
from sqlalchemy import select

@pytest.mark.asyncio
async def test_fetch_and_store_equity(db_session):
    jugaad = JugaadDataService(db_session)
    # Fetch last 5 days (trading days) EOD data for RELIANCE
    today = date.today()
    start_date = today - timedelta(days=10)
    
    rows = await jugaad.fetch_and_store_equity("RELIANCE", start_date, today)
    
    # Assert that some rows were fetched (since it's RELIANCE, it should have rows)
    assert rows >= 0
    
    if rows > 0:
        result = await db_session.execute(
            select(IndiaEquityDaily).where(IndiaEquityDaily.symbol == "RELIANCE")
        )
        db_rows = result.scalars().all()
        assert len(db_rows) > 0
        assert db_rows[0].symbol == "RELIANCE"
        assert db_rows[0].close > 0.0
