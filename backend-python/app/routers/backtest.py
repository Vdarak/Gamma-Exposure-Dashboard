import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any, Optional
from pydantic import BaseModel

from app.database import get_db
from app.services.backtester.data_loader import DuckDBDataLoader
from app.services.backtester.engine import VectorBTEngine
from app.services.backtester.options_engine import run_options_backtest

logger = logging.getLogger("gamma-exposure-backend.routers.backtest")
router = APIRouter(prefix="/api/backtest")

# Shared instance of DataLoader and VectorBTEngine
loader = DuckDBDataLoader()
vbt_engine = VectorBTEngine(loader)

class StrategyDescriptionRequest(BaseModel):
    description: str

class BacktestConfigRequest(BaseModel):
    ticker: str
    assetClass: str # 'equity' or 'option'
    startDate: str
    endDate: str
    initialCapital: float
    timeframe: str
    strategyType: Optional[str] = "long" # 'long' or 'short'
    commission: Optional[float] = 0.0
    slippagePercent: Optional[float] = 0.0
    indicators: list[dict] = []
    entryRules: dict = {"indicators": []}
    exitRules: dict = {"indicators": [], "stopLossPercent": None, "takeProfitPercent": None, "trailingStopPercent": None}

class OptionsBacktestRequest(BaseModel):
    ticker: str
    startDate: str
    endDate: str
    strategyClass: str
    takeProfitPercent: float
    stopLossPercent: float
    initialCapital: Optional[float] = 10000.0

@router.get("/tickers")
async def get_tickers():
    """Returns available tickers with daily/intraday historical data."""
    try:
        tickers = loader.get_available_tickers()
        return tickers
    except Exception as e:
        logger.error(f"Error in /tickers: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch tickers: {str(e)}")

@router.get("/ticker-info")
async def get_ticker_info(ticker: str = Query(...)):
    """Returns the date range of available historical data for a ticker."""
    try:
        info = loader.get_ticker_date_range(ticker)
        return info
    except Exception as e:
        logger.error(f"Error in /ticker-info for {ticker}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/run")
async def execute_backtest(config: BacktestConfigRequest):
    """Executes a vectorized equity backtest simulation."""
    try:
        result = await vbt_engine.run_backtest(config.model_dump())
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Error executing backtest: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/options/multileg")
async def execute_options_multileg(config: OptionsBacktestRequest, db: AsyncSession = Depends(get_db)):
    """Executes a multi-leg options backtest simulation."""
    try:
        conf = config.model_dump()
        conf["strategyClass"] = "multileg"
        result = await run_options_backtest(db, conf)
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Error executing options multileg: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/options/single-leg")
async def execute_options_single_leg(config: OptionsBacktestRequest, db: AsyncSession = Depends(get_db)):
    """Executes a single-leg options backtest simulation."""
    try:
        conf = config.model_dump()
        result = await run_options_backtest(db, conf)
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Error executing options single-leg: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/parse-strategy")
async def parse_strategy(req: StrategyDescriptionRequest):
    """Parses plain English strategy descriptions into structured JSON parameters using Gemini."""
    try:
        # Import dynamically to avoid circular import issues
        from app.services.ai.analyst import AIAnalystService
        analyst = AIAnalystService()
        parsed = await analyst.parse_strategy(req.description)
        return {
            "success": True,
            "data": parsed
        }
    except Exception as e:
        logger.error(f"Error parsing strategy: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class PortfolioBacktestRequest(BaseModel):
    strategies: list[dict]
    rebalanceFrequency: str
    driftThresholdPercent: float
    initialCapital: float
    startDate: str
    endDate: str
    benchmark: str
    commission: float
    slippage: float

@router.post("/portfolio/run")
async def execute_portfolio_backtest(config: PortfolioBacktestRequest, db: AsyncSession = Depends(get_db)):
    """Executes a multi-strategy and multi-asset portfolio backtest simulation."""
    try:
        from app.services.backtester.portfolio_engine import PortfolioBacktestEngine
        engine = PortfolioBacktestEngine(db, loader)
        result = await engine.run_portfolio_backtest(config.model_dump())
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Error executing portfolio backtest: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

