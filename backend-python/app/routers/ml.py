import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.models.ml import MLModelRegistry, MLPrediction
from app.models.option_snapshot import OptionSnapshot
from app.services.ml.pipeline import MLPipelineService

logger = logging.getLogger("gamma-exposure-backend.routers.ml")
router = APIRouter(prefix="/api/ml")

class TrainRequest(BaseModel):
    ticker: str
    startDate: str
    endDate: str

@router.post("/train")
async def train_ml_models(req: TrainRequest, db: AsyncSession = Depends(get_db)):
    """Triggers materialization and training of ML models for a given ticker and date range."""
    try:
        start_dt = datetime.strptime(req.startDate, "%Y-%m-%d")
        end_dt = datetime.strptime(req.endDate, "%Y-%m-%d")
        
        service = MLPipelineService(db)
        result = await service.train_models(req.ticker, start_dt, end_dt)
        return result
    except Exception as e:
        logger.error(f"Error in /train: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/predictions")
async def get_latest_predictions(ticker: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Fetches the latest ML prediction and confluence conviction score for a ticker."""
    try:
        # Find latest snapshot
        snap_stmt = select(OptionSnapshot).where(OptionSnapshot.ticker == ticker.upper()).order_by(desc(OptionSnapshot.timestamp)).limit(1)
        snap_res = await db.execute(snap_stmt)
        snap = snap_res.scalar_one_or_none()
        
        if not snap:
            raise HTTPException(status_code=404, detail=f"No options snapshots found for ticker {ticker}.")
            
        service = MLPipelineService(db)
        prediction = await service.predict_latest(ticker.upper(), snap.id)
        return {
            "success": True,
            "data": prediction
        }
    except Exception as e:
        logger.error(f"Error fetching predictions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/models")
async def list_models(db: AsyncSession = Depends(get_db)):
    """Lists all registered models in the model registry."""
    try:
        stmt = select(MLModelRegistry).order_by(desc(MLModelRegistry.created_at))
        res = await db.execute(stmt)
        models = res.scalars().all()
        
        return {
            "success": True,
            "data": [
                {
                    "id": m.id,
                    "model_name": m.model_name,
                    "version": m.version,
                    "file_path": m.file_path,
                    "training_date": m.training_date.isoformat(),
                    "training_samples": m.training_samples,
                    "validation_auc": float(m.validation_auc),
                    "is_active": m.is_active
                }
                for m in models
            ]
        }
    except Exception as e:
        logger.error(f"Error listing models: {e}")
        raise HTTPException(status_code=500, detail=str(e))
