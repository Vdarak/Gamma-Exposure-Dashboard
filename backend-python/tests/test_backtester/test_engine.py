import pytest
from app.services.backtester.data_loader import DuckDBDataLoader
from app.services.backtester.engine import VectorBTEngine

def test_data_loader_available_tickers():
    loader = DuckDBDataLoader()
    tickers = loader.get_available_tickers()
    assert isinstance(tickers, list)
    assert len(tickers) > 0
    assert "SPY" in tickers

def test_data_loader_date_range():
    loader = DuckDBDataLoader()
    r = loader.get_ticker_date_range("SPY")
    assert "minDate" in r
    assert "maxDate" in r
    assert r["minDate"] <= r["maxDate"]

def test_data_loader_load_daily():
    loader = DuckDBDataLoader()
    bars = loader.load_historical_data("SPY", "1d", "2023-01-01", "2023-06-30")
    assert len(bars) > 10
    first = bars[0]
    assert "timestamp" in first
    assert "open" in first
    assert "close" in first

@pytest.mark.asyncio
async def test_vectorbt_engine_run():
    loader = DuckDBDataLoader()
    engine = VectorBTEngine(loader)
    
    config = {
        "ticker": "SPY",
        "timeframe": "1d",
        "startDate": "2023-01-01",
        "endDate": "2023-06-30",
        "initialCapital": 10000.0,
        "commission": 0.1,
        "slippagePercent": 0.05,
        "strategyType": "long",
        "indicators": [
            {"type": "sma", "period1": 10},
            {"type": "sma", "period1": 50}
        ],
        "entryRules": {
            "indicators": [
                {"indicator1": "sma_10", "operator": "crosses_above", "indicator2": "sma_50"}
            ]
        },
        "exitRules": {
            "indicators": [
                {"indicator1": "sma_10", "operator": "crosses_below", "indicator2": "sma_50"}
            ],
            "stopLossPercent": 2.0,
            "takeProfitPercent": 5.0
        }
    }
    
    result = await engine.run_backtest(config)
    assert result["ticker"] == "SPY"
    assert result["initialCapital"] == 10000.0
    assert "finalCapital" in result
    assert "totalReturnPercent" in result
    assert "trades" in result
    assert "equityCurve" in result
    assert len(result["equityCurve"]) == len(result["ohlcv"]["timestamp"])
