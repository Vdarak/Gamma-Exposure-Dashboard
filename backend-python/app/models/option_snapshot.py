from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, Numeric, CHAR
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

class OptionSnapshot(Base):
    __tablename__ = "option_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    spot_price = Column(Numeric(12, 4), nullable=False)
    data_count = Column(Integer, nullable=False, default=0)
    market = Column(String(10), default="USA")
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    options = relationship("OptionData", back_populates="snapshot", cascade="all, delete-orphan")

class OptionData(Base):
    __tablename__ = "option_data"

    id = Column(Integer, primary_key=True, index=True)
    snapshot_id = Column(Integer, ForeignKey("option_snapshots.id", ondelete="CASCADE"), nullable=False, index=True)
    strike = Column(Numeric(12, 4), nullable=False, index=True)
    option_type = Column(CHAR(1), nullable=False, index=True)  # 'C' or 'P'
    expiration = Column(Date, nullable=False, index=True)
    last_price = Column(Numeric(12, 4))
    bid = Column(Numeric(12, 4))
    ask = Column(Numeric(12, 4))
    volume = Column(Integer, default=0)
    open_interest = Column(Integer, default=0)
    implied_volatility = Column(Numeric(12, 6))
    delta = Column(Numeric(12, 6))
    gamma = Column(Numeric(16, 8))
    theta = Column(Numeric(16, 8))
    vega = Column(Numeric(16, 8))
    rho = Column(Numeric(16, 8))
    change_in_oi = Column(Integer)
    total_buy_qty = Column(Integer)
    total_sell_qty = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)

    snapshot = relationship("OptionSnapshot", back_populates="options")
