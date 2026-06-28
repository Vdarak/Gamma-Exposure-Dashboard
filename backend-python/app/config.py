import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    # ── Server Config ──
    app_name: str = "Gamma Exposure Backend"
    environment: str = Field(default="development", validation_alias="ENVIRONMENT")
    port: int = Field(default=8000, validation_alias="PORT")
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")
    
    # ── Database ──
    database_url: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/gamma_exposure",
        validation_alias="DATABASE_URL"
    )
    
    # ── External APIs ──
    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    
    # ── Stripe Billing ──
    stripe_secret_key: str = Field(default="", validation_alias="STRIPE_SECRET_KEY")
    stripe_webhook_secret: str = Field(default="", validation_alias="STRIPE_WEBHOOK_SECRET")
    frontend_url: str = Field(
        default="http://localhost:3000",
        validation_alias="FRONTEND_URL"
    )
    
    # ── Indian Broker (Dhan) ──
    dhan_client_id: str = Field(default="", validation_alias="DHAN_CLIENT_ID")
    dhan_access_token: str = Field(default="", validation_alias="DHAN_ACCESS_TOKEN")
    
    # ── Data Collection Controls ──
    collect_interval_mins: int = 5
    nse_max_expiries: str = Field(default="all", validation_alias="NSE_MAX_EXPIRIES")
    
    # ── ML Settings ──
    model_storage_path: str = Field(default="./trained_models", validation_alias="MODEL_STORAGE_PATH")
    anomaly_threshold: float = Field(default=-0.3, validation_alias="ANOMALY_THRESHOLD")
    xgb_conviction_threshold: float = Field(default=0.6, validation_alias="XGB_CONVICTION_THRESHOLD")
    log_predictions: bool = Field(default=True, validation_alias="LOG_PREDICTIONS")
    
    # ── Local Historical Data ──
    data_dir: str = Field(default="/Volumes/Crucial X10/data", validation_alias="DATA_DIR")

    # Read from .env file
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

# Instantiate settings
settings = Settings()
