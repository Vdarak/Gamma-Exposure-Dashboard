from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Boolean, Text, Date, UniqueConstraint
from datetime import datetime
from app.database import Base

class MLFeatureSnapshot(Base):
    __tablename__ = "ml_feature_snapshots"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "mode", name="uq_ml_feature_snapshots"),
    )

    id = Column(Integer, primary_key=True, index=True)
    snapshot_id = Column(Integer, ForeignKey("option_snapshots.id", ondelete="CASCADE"), nullable=False, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    mode = Column(String(10), nullable=False, default="0dte", index=True) # '0dte' or 'swing'
    
    # GEX Features
    total_gex_normalized = Column(Numeric(16, 8))
    net_gex_sign = Column(Integer)
    gex_concentration = Column(Numeric(8, 6))
    call_wall_distance = Column(Numeric(8, 6))
    put_wall_distance = Column(Numeric(8, 6))
    gamma_flip_distance = Column(Numeric(8, 6))
    gex_zscore_30 = Column(Numeric(8, 4))
    
    # Flow Features
    put_call_oi_ratio = Column(Numeric(8, 4))
    put_call_volume_ratio = Column(Numeric(8, 4))
    bullish_sentiment_pct = Column(Numeric(6, 2))
    notional_flow_skew = Column(Numeric(8, 6))
    
    # Volatility Features
    atm_iv = Column(Numeric(8, 6))
    iv_skew_25d = Column(Numeric(8, 6))
    iv_term_slope = Column(Numeric(8, 6))
    realized_vs_implied = Column(Numeric(8, 6))
    bid_ask_spread_zscore = Column(Numeric(8, 4))
    
    # Price Action
    intraday_return = Column(Numeric(10, 6))
    rolling_return_30m = Column(Numeric(10, 6))
    rolling_return_60m = Column(Numeric(10, 6))
    vwap_deviation = Column(Numeric(10, 6))
    spot_return_15m = Column(Numeric(10, 6))
    
    # Temporal
    minutes_to_close = Column(Integer)
    session_half = Column(Integer)
    day_of_week = Column(Integer)
    
    # Anomaly Detection
    volume_spike_ratio = Column(Numeric(8, 4))
    oi_velocity = Column(Numeric(12, 4))
    charm_decay_rate = Column(Numeric(12, 8))
    vanna_exposure = Column(Numeric(16, 8))
    
    # Targets
    target_direction_45m = Column(Integer)
    target_breach_up_45m = Column(Integer)
    target_breach_down_45m = Column(Integer)
    target_direction_1d = Column(Integer)
    target_direction_3d = Column(Integer)
    
    created_at = Column(DateTime, default=datetime.utcnow)

class MLPrediction(Base):
    __tablename__ = "ml_predictions"

    id = Column(Integer, primary_key=True, index=True)
    snapshot_id = Column(Integer, ForeignKey("option_snapshots.id"), index=True)
    ticker = Column(String(10), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    mode = Column(String(10), nullable=False, index=True) # '0dte' or 'swing'
    
    # Isolation Forest
    is_anomaly = Column(Boolean, nullable=False, default=False)
    anomaly_score = Column(Numeric(8, 6))
    anomaly_drivers = Column(Text)              # JSON string
    
    # XGBoost
    xgb_direction = Column(String(10))          # 'BULLISH', 'BEARISH', 'NEUTRAL'
    xgb_conviction = Column(Numeric(6, 4))
    xgb_breach_up_prob = Column(Numeric(6, 4))
    xgb_breach_down_prob = Column(Numeric(6, 4))
    xgb_feature_importance = Column(Text)       # JSON string
    
    # TFT Bounds
    tft_high_p50 = Column(Numeric(12, 4))
    tft_high_p90 = Column(Numeric(12, 4))
    tft_low_p50 = Column(Numeric(12, 4))
    tft_low_p10 = Column(Numeric(12, 4))
    tft_close_p50 = Column(Numeric(12, 4))
    
    # Confluence
    confluence_signal = Column(String(20))      # 'STRONG_BULL', 'BULL', 'NEUTRAL', 'BEAR', 'STRONG_BEAR', 'HALTED'
    suggested_strikes = Column(Text)            # JSON string
    
    # Outcomes
    actual_direction = Column(Integer)
    actual_high = Column(Numeric(12, 4))
    actual_low = Column(Numeric(12, 4))
    prediction_accuracy = Column(Boolean)
    
    created_at = Column(DateTime, default=datetime.utcnow)

class MLModelRegistry(Base):
    __tablename__ = "ml_model_registry"
    __table_args__ = (
        UniqueConstraint("model_name", "version", name="uq_ml_model_registry"),
    )

    id = Column(Integer, primary_key=True, index=True)
    model_name = Column(String(50), nullable=False) # 'xgboost_0dte', etc.
    version = Column(String(20), nullable=False)
    file_path = Column(String(255), nullable=False)
    training_date = Column(Date, nullable=False)
    training_samples = Column(Integer)
    validation_auc = Column(Numeric(6, 4))
    is_active = Column(Boolean, default=True)
    model_metadata = Column("metadata", Text)                         # JSON string
    created_at = Column(DateTime, default=datetime.utcnow)
