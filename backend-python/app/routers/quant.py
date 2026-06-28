from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, Dict, Any
from datetime import date
from app.database import get_db
from app.services.quant.engine import QuantEngineService
from app.services.suggestions.service import OptionSuggestionsService
from app.services.data_retrieval import DataRetrievalService

router = APIRouter(prefix="/api")

@router.get("/quant/probability-map")
async def get_probability_map(
    ticker: str = Query(...),
    expiration: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    quant_service = QuantEngineService(db)
    result = await quant_service.get_probability_map(ticker, expiration)
    if not result.get("success", False):
        raise HTTPException(status_code=400, detail=result.get("error", "Breeden-Litzenberger calculations failed"))
    return result

@router.get("/quant/garch-forecast")
async def get_garch_forecast(
    ticker: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    quant_service = QuantEngineService(db)
    result = await quant_service.get_garch_forecast(ticker)
    if not result.get("success", False):
        raise HTTPException(status_code=400, detail=result.get("error", "GARCH forecast failed"))
    return result

@router.get("/quant/quantum-tunneling")
async def get_quantum_tunneling(
    ticker: str = Query(...),
    expiries: Optional[List[str]] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    quant_service = QuantEngineService(db)
    result = await quant_service.get_quantum_tunneling(ticker, expiries)
    if not result.get("success", False):
        raise HTTPException(status_code=400, detail=result.get("error", "Quantum Tunneling calculations failed"))
    return result

@router.get("/quant/cot-flow")
async def get_cot_flow(
    ticker: str = Query(...),
    limit: int = Query(104),
    db: AsyncSession = Depends(get_db)
):
    from app.services.ingestion.cot import CotIngestionService
    cot_service = CotIngestionService(db)
    data = await cot_service.get_historical_cot(ticker, limit)
    return {
        "success": True,
        "ticker": ticker.upper(),
        "data": data
    }

@router.get("/suggestions/history")
async def get_suggestions_history(
    ticker: str = Query("SPX"),
    limit: int = Query(100),
    db: AsyncSession = Depends(get_db)
):
    sug_service = OptionSuggestionsService(db)
    data = await sug_service.get_suggestions_history(ticker, limit)
    return {
        "success": True,
        "data": data
    }

@router.post("/suggestions/collect")
async def collect_suggestions(
    body: Dict[str, Any],
    db: AsyncSession = Depends(get_db)
):
    ticker = body.get("ticker", "SPX")
    sug_service = OptionSuggestionsService(db)
    result = await sug_service.record_option_suggestion(ticker)
    if not result:
        raise HTTPException(status_code=400, detail=f"Failed to record option suggestions for {ticker}")
    return {
        "success": True,
        "message": f"Option suggestion logged for {ticker}",
        "data": result
    }

@router.get("/historical-gex")
async def get_historical_gex(
    ticker: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    retrieval = DataRetrievalService(db)
    data = await retrieval.get_historical_gex_trend(ticker)
    return {
        "success": True,
        "data": data
    }

@router.get("/gex-flow")
async def get_gex_flow(
    ticker: str = Query(...),
    date_str: str = Query(..., alias="date"),
    db: AsyncSession = Depends(get_db)
):
    d = date.fromisoformat(date_str)
    retrieval = DataRetrievalService(db)
    data = await retrieval.get_intraday_gex_flow(ticker, d)
    return {
        "success": True,
        "data": data
    }

@router.get("/rates")
async def get_rates(db: AsyncSession = Depends(get_db)):
    """Retrieves US and India risk-free rates from the database with default fallbacks."""
    try:
        from app.models.quant import InterestRate
        from sqlalchemy import select
        from datetime import datetime

        stmt = select(InterestRate)
        res = await db.execute(stmt)
        rows = res.scalars().all()
        
        us_rate = 0.0525
        india_rate = 0.0650
        source = "Defaults (No database entries)"
        updated_at = datetime.utcnow().isoformat()
        
        if rows:
            sources = []
            for row in rows:
                if row.rate_key == "US_RISK_FREE":
                    us_rate = float(row.rate)
                    updated_at = row.updated_at.isoformat()
                elif row.rate_key == "INDIA_RISK_FREE":
                    india_rate = float(row.rate)
                if row.source:
                    sources.append(row.source)
            if sources:
                source = " / ".join(list(set(sources)))
            else:
                source = "Database"
                
        return {
            "success": True,
            "usRiskFreeRate": us_rate,
            "indiaRiskFreeRate": india_rate,
            "source": source,
            "updatedAt": updated_at
        }
    except Exception as e:
        from datetime import datetime
        return {
            "success": False,
            "usRiskFreeRate": 0.0525,
            "indiaRiskFreeRate": 0.0650,
            "source": f"Error fallback: {str(e)}",
            "updatedAt": datetime.utcnow().isoformat()
        }
