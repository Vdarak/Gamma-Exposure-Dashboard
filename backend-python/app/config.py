import os
from typing import Dict, Any, Optional
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
    dhan_password: str = Field(default="", validation_alias="DHAN_PASSWORD")
    dhan_totp_secret: str = Field(default="", validation_alias="DHAN_TOTP_SECRET")
    
    # ── Indian Market GEX Tuning ──
    dealer_alpha: float = Field(default=0.65, validation_alias="DEALER_ALPHA")
    
    # ── Ticker Configuration ──
    US_TICKERS: str = Field(default="SPX,GLD,TSLA", validation_alias="US_TICKERS")
    INDIA_TICKERS: str = Field(default="NIFTY,BANKNIFTY,SENSEX", validation_alias="INDIA_TICKERS")
    
    # ── Data Collection Controls ──
    collect_interval_mins: int = Field(default=5, validation_alias="COLLECT_INTERVAL_MINUTES")
    nse_max_expiries: str = Field(default="all", validation_alias="NSE_MAX_EXPIRIES")
    
    # ── ML Settings ──
    model_storage_path: str = Field(default="./trained_models", validation_alias="MODEL_STORAGE_PATH")
    anomaly_threshold: float = Field(default=-0.3, validation_alias="ANOMALY_THRESHOLD")
    xgb_conviction_threshold: float = Field(default=0.6, validation_alias="XGB_CONVICTION_THRESHOLD")
    log_predictions: bool = Field(default=True, validation_alias="LOG_PREDICTIONS")
    
    # ── Cron Job Switches (Accepts ON / OFF, true / false, 1 / 0) ──
    cron_option_snapshots_enabled: str = Field(default="OFF", validation_alias="CRON_OPTION_SNAPSHOTS_ENABLED")
    cron_us_options_enabled: str = Field(default="OFF", validation_alias="CRON_US_OPTIONS_ENABLED")
    cron_india_options_enabled: str = Field(default="ON", validation_alias="CRON_INDIA_OPTIONS_ENABLED")
    cron_interest_rates_enabled: str = Field(default="OFF", validation_alias="CRON_INTEREST_RATES_ENABLED")
    cron_cot_report_enabled: str = Field(default="ON", validation_alias="CRON_COT_REPORT_ENABLED")
    cron_nse_participant_enabled: str = Field(default="ON", validation_alias="CRON_NSE_PARTICIPANT_ENABLED")
    cron_dhan_token_renewal_enabled: str = Field(default="ON", validation_alias="CRON_DHAN_TOKEN_RENEWAL_ENABLED")
    cron_us_eod_enabled: str = Field(default="OFF", validation_alias="CRON_US_EOD_ENABLED")

    # ── Local Historical Data ──
    data_dir: str = Field(default="./data", validation_alias="DATA_DIR")

    # Read from .env file
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

# Instantiate settings
settings = Settings()


def is_enabled(val: Any, default: bool = True) -> bool:
    """
    Flexible helper to evaluate ON/OFF, true/false, 1/0 configuration flags.
    Case-insensitive string comparisons ensure environment variables work smoothly.
    """
    if val is None:
        return default
    if isinstance(val, bool):
        return val
    s = str(val).strip().lower()
    if s in ("1", "true", "on", "yes", "enabled", "enable"):
        return True
    if s in ("0", "false", "off", "no", "disabled", "disable"):
        return False
    return default


# ── Indian Instrument Configuration ──────────────────────────────────────────
# Lot sizes, strike steps, and metadata for Indian index options.
# This is the single source of truth used by the GEX engine and frontend.

INDIA_INSTRUMENTS: Dict[str, Dict[str, Any]] = {
    "NIFTY": {
        "lot_size": 25,
        "strike_step": 50,
        "freeze_qty": 1800,
        "exchange": "NSE",
        "underlying_seg": "IDX_I",
        "settlement": "european_cash",
        "currency": "INR",
        "expiry_day": "tuesday",
        "display_name": "Nifty 50",
    },
    "BANKNIFTY": {
        "lot_size": 15,
        "strike_step": 100,
        "freeze_qty": 900,
        "exchange": "NSE",
        "underlying_seg": "IDX_I",
        "settlement": "european_cash",
        "currency": "INR",
        "expiry_day": "wednesday",
        "display_name": "Bank Nifty",
    },
    "SENSEX": {
        "lot_size": 20,
        "strike_step": 100,
        "freeze_qty": 1000,
        "exchange": "BSE",
        "underlying_seg": "IDX_I",
        "settlement": "european_cash",
        "currency": "INR",
        "expiry_day": "thursday",
        "display_name": "Sensex",
    },
}


def get_instrument(symbol: str) -> Optional[Dict[str, Any]]:
    """Get instrument config for a given symbol (e.g. NIFTY, BANKNIFTY, SENSEX)."""
    return INDIA_INSTRUMENTS.get(symbol.upper())


def get_lot_size(symbol: str) -> int:
    """Get lot size for a given symbol. Returns 100 (US default) if not found."""
    inst = get_instrument(symbol)
    return inst["lot_size"] if inst else 100


def get_all_india_symbols() -> list:
    """Return all configured Indian index symbols."""
    return list(INDIA_INSTRUMENTS.keys())


def is_india_symbol(symbol: str) -> bool:
    """Check if a symbol is a configured Indian instrument."""
    return symbol.upper() in INDIA_INSTRUMENTS
