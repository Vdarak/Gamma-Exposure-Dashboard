import pytest
from app.services.ingestion.cot import CotIngestionService
from app.models.quant import CotPosition
from sqlalchemy import select
from datetime import date

@pytest.mark.asyncio
async def test_cot_ingestion_service(db_session):
    service = CotIngestionService(db_session)
    
    # Mock some raw CFTC rows for testing parsing
    raw_mock_data = (
        '"E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE","CHICAGO MERCANTILE EXCHANGE","2026-06-23",,'
        ',,,250000,120000,130000,,90000,100000,,,40000,20000\n'
        '"GOLD - COMMODITY EXCHANGE INC.","COMMODITY EXCHANGE INC.","2026-06-23",,'
        ',,,180000,80000,100000,,70000,60000,,,30000,20000\n'
    )
    
    # Test the internal parser
    count = await service._parse_and_save_cot_rows(raw_mock_data)
    assert count == 2
    
    # Check that database records were written
    stmt = select(CotPosition).where(CotPosition.ticker == "SPX", CotPosition.report_date == date(2026, 6, 23))
    res = await db_session.execute(stmt)
    spx_pos = res.scalar_one_or_none()
    
    assert spx_pos is not None
    assert spx_pos.ticker == "SPX"
    assert spx_pos.open_interest == 250000
    assert spx_pos.noncomm_long == 120000
    assert spx_pos.noncomm_short == 130000
    assert spx_pos.comm_long == 90000
    assert spx_pos.comm_short == 100000
    assert spx_pos.retail_long == 40000
    assert spx_pos.retail_short == 20000
    
    # Test get_historical_cot
    hist = await service.get_historical_cot("SPX")
    assert len(hist) >= 1
    # Find the one we just inserted
    matching_hist = next(h for h in hist if h["reportDate"] == "2026-06-23")
    assert matching_hist["commNet"] == 90000 - 100000
    assert matching_hist["noncommNet"] == 120000 - 130000
    assert matching_hist["retailNet"] == 40000 - 20000
