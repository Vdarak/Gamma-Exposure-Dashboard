from datetime import datetime, date
from pydantic import BaseModel, Field
from typing import Optional, List

class OptionContract(BaseModel):
    strike: float
    option_type: str = Field(pattern="^[CP]$")  # 'C' or 'P'
    expiration: date
    last_price: float = 0.0
    bid: float = 0.0
    ask: float = 0.0
    volume: int = 0
    open_interest: int = 0
    implied_volatility: float = 0.0
    
    # Optional Greeks (computed or fetched)
    delta: Optional[float] = 0.0
    gamma: Optional[float] = 0.0
    theta: Optional[float] = 0.0
    vega: Optional[float] = 0.0
    rho: Optional[float] = 0.0
    
    # Optional flow details
    change_in_oi: Optional[int] = 0
    total_buy_qty: Optional[int] = 0
    total_sell_qty: Optional[int] = 0

class NormalizedSnapshot(BaseModel):
    ticker: str
    timestamp: datetime
    spot_price: float
    market: str = "USA"  # "USA" or "IND"
    options: List[OptionContract]
