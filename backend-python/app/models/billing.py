from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime
from app.database import Base

class WaitlistSignup(Base):
    __tablename__ = "waitlist_signups"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    tier = Column(String(50), nullable=False, default="Free")
    status = Column(String(20), default="pending")  # 'pending', 'paid'
    stripe_session_id = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)
