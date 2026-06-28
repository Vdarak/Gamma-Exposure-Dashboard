from app.database import Base
from app.models.option_snapshot import OptionSnapshot, OptionData
from app.models.quant import IndiaEquityDaily, IndiaFoDaily, InterestRate, CotPosition, SpotPriceHistory, DailyOptionSummary, QuantForecast, EarningsDate
from app.models.ml import MLFeatureSnapshot, MLPrediction, MLModelRegistry
from app.models.billing import WaitlistSignup
from app.models.suggestion import OptionSuggestionHistory
from app.models.journal import JournalTrade, JournalSetting

# Expose Base and all models for Alembic autodetect
__all__ = [
    "Base",
    "OptionSnapshot",
    "OptionData",
    "IndiaEquityDaily",
    "IndiaFoDaily",
    "InterestRate",
    "CotPosition",
    "SpotPriceHistory",
    "DailyOptionSummary",
    "QuantForecast",
    "EarningsDate",
    "MLFeatureSnapshot",
    "MLPrediction",
    "MLModelRegistry",
    "WaitlistSignup",
    "OptionSuggestionHistory",
    "JournalTrade",
    "JournalSetting",
]
