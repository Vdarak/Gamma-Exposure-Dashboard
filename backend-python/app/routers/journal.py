from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Any, Optional
from app.database import get_db
from app.services.journal.service import JournalService, JournalTradeSchema

router = APIRouter(prefix="/api/journal")

@router.get("/trades", response_model=List[JournalTradeSchema])
async def get_trades(db: AsyncSession = Depends(get_db)):
    service = JournalService(db)
    return await service.get_trades()

@router.post("/trades", response_model=JournalTradeSchema)
async def create_trade(
    trade: JournalTradeSchema,
    db: AsyncSession = Depends(get_db)
):
    service = JournalService(db)
    return await service.create_trade(trade)

@router.put("/trades/{trade_id}", response_model=JournalTradeSchema)
async def update_trade(
    trade_id: str,
    trade_patch: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db)
):
    service = JournalService(db)
    result = await service.update_trade(trade_id, trade_patch)
    if not result:
        raise HTTPException(status_code=404, detail="Trade not found")
    return result

@router.delete("/trades/{trade_id}")
async def delete_trade(
    trade_id: str,
    db: AsyncSession = Depends(get_db)
):
    service = JournalService(db)
    success = await service.delete_trade(trade_id)
    if not success:
        raise HTTPException(status_code=404, detail="Trade not found")
    return {"success": True, "message": "Trade deleted successfully"}

@router.get("/settings/{key}")
async def get_setting(
    key: str,
    db: AsyncSession = Depends(get_db)
):
    service = JournalService(db)
    value = await service.get_setting(key)
    if value is None:
        raise HTTPException(status_code=404, detail=f"Setting for key {key} not found")
    return {"success": True, "key": key, "value": value}

@router.put("/settings/{key}")
async def update_setting(
    key: str,
    body: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db)
):
    value = body.get("value")
    if value is None:
        raise HTTPException(status_code=400, detail="Value parameter is required")
        
    service = JournalService(db)
    await service.update_setting(key, value)
    return {"success": True, "key": key, "value": value}
