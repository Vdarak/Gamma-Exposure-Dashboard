from sqlalchemy import Column, Integer, String, Date, DateTime, Numeric, BigInteger, UniqueConstraint
from datetime import datetime
from app.database import Base

class IndiaEquityDaily(Base):
    __tablename__ = "india_equity_daily"
    __table_args__ = (
        UniqueConstraint("symbol", "date", "series", name="uq_india_equity_daily"),
    )

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    series = Column(String(5), default="EQ")
    date = Column(Date, nullable=False, index=True)
    open = Column(Numeric(12, 2))
    high = Column(Numeric(12, 2))
    low = Column(Numeric(12, 2))
    close = Column(Numeric(12, 2))
    last_traded = Column(Numeric(12, 2))
    prev_close = Column(Numeric(12, 2))
    volume = Column(BigInteger)
    traded_value = Column(Numeric(18, 2))
    total_trades = Column(Integer)
    vwap = Column(Numeric(12, 2))
    delivery_qty = Column(BigInteger)
    delivery_pct = Column(Numeric(6, 2))
    week52_high = Column(Numeric(12, 2))
    week52_low = Column(Numeric(12, 2))
    created_at = Column(DateTime, default=datetime.utcnow)

class IndiaFoDaily(Base):
    __tablename__ = "india_fo_daily"
    __table_args__ = (
        UniqueConstraint("symbol", "date", "expiry_date", "strike_price", "option_type", "instrument", name="uq_india_fo_daily"),
    )

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    instrument = Column(String(10), nullable=False)  # OPTIDX, OPTSTK, FUTIDX, FUTSTK
    date = Column(Date, nullable=False, index=True)
    expiry_date = Column(Date, nullable=False, index=True)
    strike_price = Column(Numeric(12, 2))
    option_type = Column(String(2))                 # CE, PE or None
    open = Column(Numeric(12, 2))
    high = Column(Numeric(12, 2))
    low = Column(Numeric(12, 2))
    close = Column(Numeric(12, 2))
    settle_price = Column(Numeric(12, 2))
    volume = Column(BigInteger)
    traded_value = Column(Numeric(18, 2))
    open_interest = Column(BigInteger)
    change_in_oi = Column(BigInteger)
    market_lot = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)

class InterestRate(Base):
    __tablename__ = "interest_rates"

    id = Column(Integer, primary_key=True, index=True)
    rate_key = Column(String(30), unique=True, nullable=False, index=True) # e.g. 'US_RISK_FREE'
    rate = Column(Numeric(8, 6), nullable=False)
    source = Column(String(100))
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class CotPosition(Base):
    __tablename__ = "cot_positions"
    __table_args__ = (
        UniqueConstraint("ticker", "report_date", name="uq_cot_positions"),
    )

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    report_date = Column(Date, nullable=False)
    open_interest = Column(Integer, nullable=False, default=0)
    noncomm_long = Column(Integer, nullable=False)
    noncomm_short = Column(Integer, nullable=False)
    comm_long = Column(Integer, nullable=False)
    comm_short = Column(Integer, nullable=False)
    retail_long = Column(Integer, nullable=False)
    retail_short = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class SpotPriceHistory(Base):
    __tablename__ = "spot_price_history"
    __table_args__ = (
        UniqueConstraint("ticker", "timestamp", name="uq_spot_price_history"),
    )

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    spot_price = Column(Numeric(12, 4), nullable=False)

class DailyOptionSummary(Base):
    __tablename__ = "daily_option_summary"
    __table_args__ = (
        UniqueConstraint("ticker", "trade_date", name="uq_daily_option_summary"),
    )

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    trade_date = Column(Date, nullable=False)
    total_call_oi = Column(BigInteger)
    total_put_oi = Column(BigInteger)
    total_call_volume = Column(BigInteger)
    total_put_volume = Column(BigInteger)
    put_call_ratio = Column(Numeric(8, 4))
    total_gex = Column(Numeric(20, 4))
    gamma_flip_strike = Column(Numeric(12, 4))
    spot_open = Column(Numeric(12, 4))
    spot_close = Column(Numeric(12, 4))
    snapshot_count = Column(Integer)

class QuantForecast(Base):
    __tablename__ = "quant_forecasts"
    __table_args__ = (
        UniqueConstraint("ticker", "forecast_date", name="uq_quant_forecasts"),
    )

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    forecast_date = Column(Date, nullable=False)
    garch_vol_10d = Column(Numeric(8, 6), nullable=False)
    garch_vol_20d = Column(Numeric(8, 6), nullable=False)
    garch_vol_30d = Column(Numeric(8, 6), nullable=False)
    omega = Column(Numeric(16, 10), nullable=False)
    alpha = Column(Numeric(8, 6), nullable=False)
    beta = Column(Numeric(8, 6), nullable=False)
    unconditional_vol = Column(Numeric(8, 6), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class EarningsDate(Base):
    __tablename__ = "earnings_dates"

    ticker = Column(String(10), primary_key=True)
    next_earnings_date = Column(Date, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
