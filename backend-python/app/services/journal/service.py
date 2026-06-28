import uuid
import logging
from datetime import datetime, date, time
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, delete
from sqlalchemy.dialects.postgresql import insert
from app.models.journal import JournalTrade, JournalSetting

logger = logging.getLogger("gamma-exposure-backend.journal")

class JournalTradeSchema(BaseModel):
    id: str
    tradeDate: str
    timeEntered: Optional[str] = None
    timeExited: Optional[str] = None
    ticker: str
    tradeType: str
    strike: Optional[float] = None
    optionType: Optional[str] = None
    expiration: Optional[str] = None
    direction: str
    quality: str
    pnl: float
    pnlPercent: float
    screenshot: Optional[str] = None
    rationale: Optional[str] = None
    strategy: Optional[str] = None
    quantity: float
    entryPrice: float
    exitPrice: float
    fees: float = 0.0
    status: str = "Closed"

class JournalService:
    """
    Service to manage journal trades and user-specific configurations.
    """
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    def _map_model_to_schema(self, trade: JournalTrade) -> JournalTradeSchema:
        trade_date_str = trade.trade_date.isoformat() if isinstance(trade.trade_date, (date, datetime)) else str(trade.trade_date)
        expiration_str = trade.expiration.isoformat() if isinstance(trade.expiration, (date, datetime)) else (str(trade.expiration) if trade.expiration else None)
        
        # Convert time to HH:MM string
        time_entered_str = trade.time_entered.strftime("%H:%M") if isinstance(trade.time_entered, time) else (str(trade.time_entered)[:5] if trade.time_entered else None)
        time_exited_str = trade.time_exited.strftime("%H:%M") if isinstance(trade.time_exited, time) else (str(trade.time_exited)[:5] if trade.time_exited else None)

        return JournalTradeSchema(
            id=trade.id,
            tradeDate=trade_date_str,
            timeEntered=time_entered_str,
            timeExited=time_exited_str,
            ticker=trade.ticker,
            tradeType=trade.trade_type,
            strike=float(trade.strike) if trade.strike is not None else None,
            optionType=trade.option_type,
            expiration=expiration_str,
            direction=trade.direction,
            quality=trade.quality,
            pnl=float(trade.pnl),
            pnlPercent=float(trade.pnl_percent),
            screenshot=trade.screenshot,
            rationale=trade.rationale,
            strategy=trade.strategy,
            quantity=float(trade.quantity),
            entryPrice=float(trade.entry_price),
            exitPrice=float(trade.exit_price),
            fees=float(trade.fees or 0.0),
            status=trade.status or "Closed"
        )

    async def get_trades(self) -> List[JournalTradeSchema]:
        stmt = select(JournalTrade).order_by(desc(JournalTrade.trade_date), desc(JournalTrade.time_entered))
        res = await self.db.execute(stmt)
        trades = res.scalars().all()
        return [self._map_model_to_schema(t) for t in trades]

    async def get_trade_by_id(self, trade_id: str) -> Optional[JournalTradeSchema]:
        stmt = select(JournalTrade).where(JournalTrade.id == trade_id)
        res = await self.db.execute(stmt)
        trade = res.scalar_one_or_none()
        if not trade:
            return None
        return self._map_model_to_schema(trade)

    async def create_trade(self, trade_data: JournalTradeSchema) -> JournalTradeSchema:
        # Convert date/time fields
        t_date = date.fromisoformat(trade_data.tradeDate)
        t_exp = date.fromisoformat(trade_data.expiration) if trade_data.expiration else None
        
        t_enter = time.fromisoformat(trade_data.timeEntered) if trade_data.timeEntered else None
        t_exit = time.fromisoformat(trade_data.timeExited) if trade_data.timeExited else None

        new_trade = JournalTrade(
            id=trade_data.id or str(uuid.uuid4()),
            trade_date=t_date,
            time_entered=t_enter,
            time_exited=t_exit,
            ticker=trade_data.ticker.upper(),
            trade_type=trade_data.tradeType,
            strike=trade_data.strike,
            option_type=trade_data.optionType,
            expiration=t_exp,
            direction=trade_data.direction,
            quality=trade_data.quality,
            pnl=trade_data.pnl,
            pnl_percent=trade_data.pnlPercent,
            screenshot=trade_data.screenshot,
            rationale=trade_data.rationale,
            strategy=trade_data.strategy,
            quantity=trade_data.quantity,
            entry_price=trade_data.entryPrice,
            exit_price=trade_data.exitPrice,
            fees=trade_data.fees,
            status=trade_data.status
        )

        self.db.add(new_trade)
        await self.db.commit()
        await self.db.refresh(new_trade)
        return self._map_model_to_schema(new_trade)

    async def update_trade(self, trade_id: str, trade_patch: Dict[str, Any]) -> Optional[JournalTradeSchema]:
        stmt = select(JournalTrade).where(JournalTrade.id == trade_id)
        res = await self.db.execute(stmt)
        trade = res.scalar_one_or_none()
        if not trade:
            return None

        # Apply updates
        if "tradeDate" in trade_patch:
            trade.trade_date = date.fromisoformat(trade_patch["tradeDate"])
        if "timeEntered" in trade_patch:
            trade.time_entered = time.fromisoformat(trade_patch["timeEntered"]) if trade_patch["timeEntered"] else None
        if "timeExited" in trade_patch:
            trade.time_exited = time.fromisoformat(trade_patch["timeExited"]) if trade_patch["timeExited"] else None
        if "ticker" in trade_patch:
            trade.ticker = trade_patch["ticker"].upper()
        if "tradeType" in trade_patch:
            trade.trade_type = trade_patch["tradeType"]
        if "strike" in trade_patch:
            trade.strike = trade_patch["strike"]
        if "optionType" in trade_patch:
            trade.option_type = trade_patch["optionType"]
        if "expiration" in trade_patch:
            trade.expiration = date.fromisoformat(trade_patch["expiration"]) if trade_patch["expiration"] else None
        if "direction" in trade_patch:
            trade.direction = trade_patch["direction"]
        if "quality" in trade_patch:
            trade.quality = trade_patch["quality"]
        if "pnl" in trade_patch:
            trade.pnl = trade_patch["pnl"]
        if "pnlPercent" in trade_patch:
            trade.pnl_percent = trade_patch["pnlPercent"]
        if "screenshot" in trade_patch:
            trade.screenshot = trade_patch["screenshot"]
        if "rationale" in trade_patch:
            trade.rationale = trade_patch["rationale"]
        if "strategy" in trade_patch:
            trade.strategy = trade_patch["strategy"]
        if "quantity" in trade_patch:
            trade.quantity = trade_patch["quantity"]
        if "entryPrice" in trade_patch:
            trade.entry_price = trade_patch["entryPrice"]
        if "exitPrice" in trade_patch:
            trade.exit_price = trade_patch["exitPrice"]
        if "fees" in trade_patch:
            trade.fees = trade_patch["fees"]
        if "status" in trade_patch:
            trade.status = trade_patch["status"]

        await self.db.commit()
        await self.db.refresh(trade)
        return self._map_model_to_schema(trade)

    async def delete_trade(self, trade_id: str) -> bool:
        stmt = select(JournalTrade).where(JournalTrade.id == trade_id)
        res = await self.db.execute(stmt)
        trade = res.scalar_one_or_none()
        if not trade:
            return False
            
        await self.db.delete(trade)
        await self.db.commit()
        return True

    async def get_setting(self, key: str) -> Optional[str]:
        stmt = select(JournalSetting.value).where(JournalSetting.key == key)
        res = await self.db.execute(stmt)
        return res.scalar()

    async def update_setting(self, key: str, value: str) -> None:
        stmt = insert(JournalSetting).values(
            key=key,
            value=value
        ).on_conflict_do_update(
            index_elements=["key"],
            set_={"value": value}
        )
        await self.db.execute(stmt)
        await self.db.commit()
