import pytest
from app.services.backtester.data_loader import DuckDBDataLoader
from app.services.backtester.portfolio_engine import PortfolioBacktestEngine
from app.database import AsyncSessionLocal

@pytest.mark.asyncio
async def test_portfolio_backtest_run():
    loader = DuckDBDataLoader()
    async with AsyncSessionLocal() as session:
        engine = PortfolioBacktestEngine(session, loader)
        
        config = {
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
                        "indicators": [{"type": "sma", "period1": 10}],
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
                        "indicators": [{"type": "sma", "period1": 20}],
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
        
        result = await engine.run_portfolio_backtest(config)
        
        assert result["initialCapital"] == 100000.0
        assert "finalCapital" in result
        assert "totalReturnPercent" in result
        assert "cagr" in result
        assert "maxDrawdownPercent" in result
        assert "sharpeRatio" in result
        assert "sortinoRatio" in result
        assert "trades" in result
        assert "equityCurve" in result
        
        curve = result["equityCurve"]
        assert len(curve) > 0
        first_point = curve[0]
        assert "portfolioValue" in first_point
        assert "cash" in first_point
        assert "equityValue" in first_point
        assert "optionsValue" in first_point
        assert "marginHeld" in first_point
        assert "benchmarkValue" in first_point
