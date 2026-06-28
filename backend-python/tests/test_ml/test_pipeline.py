import pytest
from datetime import datetime, date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from decimal import Decimal

from app.models.option_snapshot import OptionSnapshot, OptionData
from app.models.quant import SpotPriceHistory
from app.services.ml.materializer import MLFeatureMaterializer
from app.services.ml.pipeline import MLPipelineService

@pytest.mark.asyncio
async def test_feature_materializer(db_session: AsyncSession):
    # 1. Insert dummy option snapshot and option data
    snap = OptionSnapshot(
        ticker="SPY",
        timestamp=datetime.now(),
        spot_price=Decimal("450.0"),
        market="US"
    )
    db_session.add(snap)
    await db_session.commit()
    await db_session.refresh(snap)

    opt1 = OptionData(
        snapshot_id=snap.id,
        strike=Decimal("450.0"),
        option_type="C",
        expiration=date.today() + timedelta(days=1),
        bid=Decimal("2.5"),
        ask=Decimal("2.7"),
        volume=1000,
        open_interest=5000,
        implied_volatility=Decimal("0.18"),
        delta=Decimal("0.5"),
        gamma=Decimal("0.02"),
        theta=Decimal("-0.1"),
        vega=Decimal("0.8")
    )
    opt2 = OptionData(
        snapshot_id=snap.id,
        strike=Decimal("450.0"),
        option_type="P",
        expiration=date.today() + timedelta(days=1),
        bid=Decimal("2.4"),
        ask=Decimal("2.6"),
        volume=1200,
        open_interest=6000,
        implied_volatility=Decimal("0.19"),
        delta=Decimal("-0.5"),
        gamma=Decimal("0.02"),
        theta=Decimal("-0.1"),
        vega=Decimal("0.8")
    )
    db_session.add_all([opt1, opt2])

    # Insert spot price history
    hist = SpotPriceHistory(
        ticker="SPY",
        timestamp=datetime.now() - timedelta(minutes=15),
        spot_price=Decimal("448.0")
    )
    db_session.add(hist)
    await db_session.commit()

    # 2. Materialize features
    materializer = MLFeatureMaterializer(db_session)
    feat = await materializer.compute_snapshot_features(snap.id)
    
    assert feat is not None
    assert feat["ticker"] == "SPY"
    assert feat["net_gex_sign"] in [-1, 1]
    assert "total_gex_normalized" in feat
    assert feat["spot_return_15m"] > 0 # spot 450 vs hist 448

@pytest.mark.asyncio
async def test_pipeline_fallback_prediction(db_session: AsyncSession):
    # Test pipeline prediction fallback when no models are trained yet
    snap = OptionSnapshot(
        ticker="QQQ",
        timestamp=datetime.now(),
        spot_price=Decimal("350.0"),
        market="US"
    )
    db_session.add(snap)
    await db_session.commit()
    await db_session.refresh(snap)

    pipeline = MLPipelineService(db_session)
    pred = await pipeline.predict_latest("QQQ", snap.id)
    assert pred["ticker"] == "QQQ"
    assert pred["confluence_signal"] == "NEUTRAL"
    assert pred["xgb_direction"] == "NEUTRAL"
