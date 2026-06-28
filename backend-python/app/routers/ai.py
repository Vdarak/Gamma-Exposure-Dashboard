import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

from app.database import get_db
from app.services.ai.analyst import AIAnalystService

logger = logging.getLogger("gamma-exposure-backend.routers.ai")
router = APIRouter()

# Shared analyst service
analyst_service = AIAnalystService()

class ChatRequest(BaseModel):
    message: str
    history: List[Dict[str, str]] = []
    ticker: Optional[str] = "SPX"
    livePrice: Optional[float] = 0.0
    uiContext: Optional[Dict[str, Any]] = None
    is0DteMode: Optional[bool] = False
    optionData: Optional[List[Dict[str, Any]]] = None

class PineScriptRequest(BaseModel):
    strategy_config: Dict[str, Any]

@router.get("/api/analyze")
async def get_briefing(
    ticker: str = Query(...),
    timeframe: str = Query("Intraday"),
    db: AsyncSession = Depends(get_db)
):
    """Generates an options and GEX market briefing for the specified ticker."""
    try:
        briefing = await analyst_service.generate_briefing(db, ticker, timeframe)
        return {
            "success": True,
            "analysis": briefing
        }
    except Exception as e:
        logger.error(f"Error in /api/analyze: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/analyst/chat")
async def process_chat(req: ChatRequest, db: AsyncSession = Depends(get_db)):
    """Handles conversational chat messages with database trade logging tool support."""
    try:
        result = await analyst_service.process_chat(
            db=db,
            message=req.message,
            history=req.history,
            ticker=req.ticker,
            live_price=req.livePrice,
            ui_context=req.uiContext,
            is_0dte_mode=req.is0DteMode,
            option_data=req.optionData
        )
        return result
    except Exception as e:
        logger.error(f"Error in /api/analyst/chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/ai/generate-pinescript")
async def generate_pinescript(req: PineScriptRequest):
    """Generates TradingView Pine Script v5 code from strategy parameters."""
    try:
        code = await analyst_service.generate_pinescript(req.strategy_config)
        return {
            "success": True,
            "code": code
        }
    except Exception as e:
        logger.error(f"Error generating pinescript: {e}")
        raise HTTPException(status_code=500, detail=str(e))
