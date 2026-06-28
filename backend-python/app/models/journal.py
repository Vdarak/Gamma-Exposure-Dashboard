from sqlalchemy import Column, Integer, String, Date, Time, Numeric, CHAR, Text, DateTime
from datetime import datetime
from app.database import Base

class JournalTrade(Base):
    __tablename__ = "journal_trades"

    id = Column(String(50), primary_key=True)
    trade_date = Column(Date, nullable=False, index=True)
    time_entered = Column(Time)
    time_exited = Column(Time)
    ticker = Column(String(15), nullable=False, index=True)
    trade_type = Column(String(10), nullable=False)  # 'Equity' or 'Option'
    strike = Column(Numeric(12, 4))
    option_type = Column(CHAR(1))                    # 'C' or 'P'
    expiration = Column(Date)
    direction = Column(String(10), nullable=False)   # 'Buy' or 'Sell'
    quality = Column(CHAR(1), nullable=False)        # 'S', 'A', 'B'
    pnl = Column(Numeric(12, 2), nullable=False)
    pnl_percent = Column(Numeric(8, 2), nullable=False)
    screenshot = Column(Text)                         # Base64 JPEG string
    rationale = Column(Text)
    strategy = Column(String(50))
    quantity = Column(Numeric(12, 4), nullable=False, default=0.0)
    entry_price = Column(Numeric(12, 4), nullable=False, default=0.0)
    exit_price = Column(Numeric(12, 4), nullable=False, default=0.0)
    fees = Column(Numeric(12, 2), default=0.0)
    status = Column(String(10), default="Closed")    # 'Open', 'Closed'
    created_at = Column(DateTime, default=datetime.utcnow)

class JournalSetting(Base):
    __tablename__ = "journal_settings"

    key = Column(String(50), primary_key=True)
    value = Column(String(255), nullable=False)
