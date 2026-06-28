import pytest
from unittest.mock import MagicMock, AsyncMock
from datetime import datetime, date, time
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.ai.analyst import AIAnalystService
from app.models.journal import JournalTrade

@pytest.mark.asyncio
async def test_ai_analyst_briefing_no_key():
    # If client is None, it should return configuration error message
    analyst = AIAnalystService()
    analyst.client = None
    
    res = await analyst.generate_briefing(None, "SPX")
    assert "not configured" in res

@pytest.mark.asyncio
async def test_parse_strategy_mocked():
    analyst = AIAnalystService()
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = '{"indicators": [{"type": "rsi", "period1": 14}], "entryRules": {"indicators": []}, "exitRules": {"indicators": []}, "shouldExecute": true}'
    mock_client.models.generate_content.return_value = mock_response
    analyst.client = mock_client
    
    parsed = await analyst.parse_strategy("Buy when RSI 14 crosses below 30")
    assert parsed["shouldExecute"] is True
    assert parsed["indicators"][0]["type"] == "rsi"
    assert parsed["indicators"][0]["period1"] == 14

@pytest.mark.asyncio
async def test_generate_pinescript_mocked():
    analyst = AIAnalystService()
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = "//@version=5\nstrategy('Test')"
    mock_client.models.generate_content.return_value = mock_response
    analyst.client = mock_client
    
    code = await analyst.generate_pinescript({"indicators": []})
    assert "strategy" in code
    assert "//@version=5" in code

@pytest.mark.asyncio
async def test_process_chat_view_trades_mocked(db_session: AsyncSession):
    # Insert a dummy trade first to view it
    dummy = JournalTrade(
        id="trade_test_123",
        trade_date=date.today(),
        time_entered=time(9, 30),
        time_exited=time(16, 0),
        ticker="SPY",
        trade_type="Equity",
        direction="Buy",
        quantity=Decimal("100"),
        entry_price=Decimal("400.0"),
        exit_price=Decimal("410.0"),
        pnl=Decimal("1000.0"),
        pnl_percent=Decimal("2.5"),
        quality="A",
        rationale="Setup",
        strategy="Breakout",
        status="Closed"
    )
    db_session.add(dummy)
    await db_session.commit()

    analyst = AIAnalystService()
    mock_client = MagicMock()
    
    # Mock view_trades function call candidate
    mock_part = MagicMock()
    mock_part.function_call = MagicMock()
    mock_part.function_call.name = "view_trades"
    mock_part.function_call.args = {"tradeDate": date.today().isoformat()}
    
    mock_candidate = MagicMock()
    mock_candidate.content.parts = [mock_part]
    
    mock_response = MagicMock()
    mock_response.candidates = [mock_candidate]
    
    mock_client.models.generate_content.return_value = mock_response
    analyst.client = mock_client
    
    res = await analyst.process_chat(
        db=db_session,
        message="Show me my trades",
        ticker="SPY"
    )
    
    assert "text" in res
    assert "SPY" in res["text"]
