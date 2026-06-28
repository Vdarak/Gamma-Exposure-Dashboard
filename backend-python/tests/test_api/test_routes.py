import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from datetime import datetime, date
from decimal import Decimal
from app.models.option_snapshot import OptionSnapshot
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import AsyncSessionLocal

@pytest.mark.asyncio
async def test_health_endpoint():
    # Use standard ASGITransport for testing FastAPI app asynchronously
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/health")
        assert res.status_code == 200
        assert res.json()["status"] == "healthy"

@pytest.mark.asyncio
async def test_waitlist_signup():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post("/api/waitlist/signup", json={"email": "signup-tester@example.com", "tier": "Pro"})
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["data"]["email"] == "signup-tester@example.com"
        assert data["data"]["tier"] == "Pro"
        assert data["data"]["status"] == "pending"

@pytest.mark.asyncio
async def test_billing_checkout_simulation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post("/api/billing/create-checkout-session", json={"email": "checkout-tester@example.com", "tier": "Lifetime"})
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "sessionId" in data
        assert "checkoutUrl" in data

@pytest.mark.asyncio
async def test_billing_sim_payment_success():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Create session
        res = await ac.post("/api/billing/create-checkout-session", json={"email": "sim-tester@example.com", "tier": "Lifetime"})
        session_id = res.json()["sessionId"]
        
        # Trigger success
        res_success = await ac.post("/api/billing/sim-payment-success", json={"sessionId": session_id, "email": "sim-tester@example.com"})
        assert res_success.status_code == 200
        data = res_success.json()
        assert data["success"] is True
        assert data["data"]["status"] == "paid"

@pytest.mark.asyncio
async def test_backtest_tickers():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/backtest/tickers")
        assert res.status_code == 200
        assert isinstance(res.json(), list)
        assert "SPY" in res.json()

@pytest.mark.asyncio
async def test_backtest_ticker_info():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/backtest/ticker-info?ticker=SPY")
        assert res.status_code == 200
        data = res.json()
        assert "minDate" in data
        assert "maxDate" in data

@pytest.mark.asyncio
async def test_backtest_run_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        config = {
            "ticker": "SPY",
            "assetClass": "equity",
            "startDate": "2023-01-01",
            "endDate": "2023-06-30",
            "initialCapital": 10000.0,
            "timeframe": "1d",
            "strategyType": "long",
            "commission": 0.0,
            "slippagePercent": 0.0,
            "indicators": [],
            "entryRules": {"indicators": []},
            "exitRules": {"indicators": [], "stopLossPercent": None, "takeProfitPercent": None, "trailingStopPercent": None}
        }
        res = await ac.post("/api/backtest/run", json=config)
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        res_data = data["data"]
        assert res_data["ticker"] == "SPY"
        assert "finalCapital" in res_data
        assert "totalReturnPercent" in res_data

@pytest.mark.asyncio
async def test_ml_models_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/ml/models")
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert isinstance(data["data"], list)

@pytest.mark.asyncio
async def test_ml_predictions_endpoint():
    # Insert a dummy option snapshot for predictions
    snap_id = None
    async with AsyncSessionLocal() as session:
        snap = OptionSnapshot(
            ticker="SPY",
            timestamp=datetime.now(),
            spot_price=Decimal("450.0"),
            market="US"
        )
        session.add(snap)
        await session.commit()
        await session.refresh(snap)
        snap_id = snap.id

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            res = await ac.get("/api/ml/predictions?ticker=SPY")
            assert res.status_code == 200
            data = res.json()
            assert data["success"] is True
            pred = data["data"]
            assert pred["ticker"] == "SPY"
            assert "confluence_signal" in pred
    finally:
        if snap_id is not None:
            async with AsyncSessionLocal() as session:
                await session.execute(text("DELETE FROM option_snapshots WHERE id = :id"), {"id": snap_id})
                await session.commit()

@pytest.mark.asyncio
async def test_rates_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/rates")
        assert res.status_code == 200
        data = res.json()
        assert "success" in data
        assert "usRiskFreeRate" in data
        assert "indiaRiskFreeRate" in data
        assert "source" in data

@pytest.mark.asyncio
async def test_portfolio_backtest_route():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        payload = {
            "strategies": [
                {
                    "id": "strat1",
                    "name": "SPY Strategy",
                    "type": "equity",
                    "ticker": "SPY",
                    "weight": 0.5,
                    "config": {
                        "timeframe": "1d",
                        "strategyType": "long",
                        "indicators": [],
                        "entryRules": {"indicators": []},
                        "exitRules": {"indicators": []}
                    }
                },
                {
                    "id": "strat2",
                    "name": "SPY Short Strategy",
                    "type": "equity",
                    "ticker": "SPY",
                    "weight": 0.5,
                    "config": {
                        "timeframe": "1d",
                        "strategyType": "short",
                        "indicators": [],
                        "entryRules": {"indicators": []},
                        "exitRules": {"indicators": []}
                    }
                }
            ],
            "rebalanceFrequency": "weekly",
            "driftThresholdPercent": 5.0,
            "initialCapital": 100000.0,
            "startDate": "2023-01-01",
            "endDate": "2023-06-30",
            "benchmark": "SPY",
            "commission": 0.05,
            "slippage": 0.1
        }
        res = await ac.post("/api/backtest/portfolio/run", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "data" in data
        assert "initialCapital" in data["data"]
        assert "equityCurve" in data["data"]
