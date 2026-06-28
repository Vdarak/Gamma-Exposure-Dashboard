from sqlalchemy import Column, Integer, String, DateTime, Numeric, Text
from datetime import datetime
from app.database import Base

class OptionSuggestionHistory(Base):
    __tablename__ = "option_suggestions_history"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    spot_price = Column(Numeric(12, 4), nullable=False)
    suggestion_type = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    strikes = Column(Text, nullable=False)
    entry_trigger = Column(Text, nullable=False)
    risk_reward = Column(Text, nullable=False)
    confidence_score = Column(Integer, nullable=False)
    ppi = Column(Integer, nullable=False)
    recorded_legs = Column(Text)  # JSON string
    created_at = Column(DateTime, default=datetime.utcnow)
