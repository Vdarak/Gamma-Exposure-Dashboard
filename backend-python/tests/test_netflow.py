import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.flow.netflow import OptionsNetFlowService


@pytest.mark.asyncio
async def test_options_net_flow_service_with_mock_db():
    """
    Test that the optimized LAG window-function based service correctly:
    1. Calls the latest snapshot date query
    2. Calls spot price query
    3. Calls the main LAG window-function flow query
    4. Calls the prior EOD close snapshot ID query
    5. Returns correctly structured response with buys and sells
    """
    mock_db = AsyncMock()
    mock_execute = AsyncMock()
    mock_db.execute = mock_execute

    # ── Mock 1: Latest snapshot date query ───────────────────────────
    mock_date_res = MagicMock()
    mock_date_res.scalar.return_value = None  # Will fall back to date.today()

    # ── Mock 2: Spot price query ──────────────────────────────────────
    mock_spot_res = MagicMock()
    mock_spot_res.scalar.return_value = 100.50  # spot price

    # ── Mock 3: Main LAG flow query result ───────────────────────────
    # Simulates: C 105, bought 25 contracts at last_price 1.27
    mock_flow_row = {
        "strike": 105.00,
        "option_type": "C",
        "expiration": "2026-07-02",
        "last_price": 1.27,
        "bid": 1.18,
        "ask": 1.28,
        "volume": 35,
        "open_interest": 120,
        "iv": 0.26,
        "bought_volume": 25.0,
        "written_volume": 0.0,
    }
    mock_flow_res = MagicMock()
    mock_flow_res.mappings.return_value.all.return_value = [mock_flow_row]

    # ── Mock 4: Prior EOD snapshot ID query ──────────────────────────
    mock_prior_snap_id_res = MagicMock()
    mock_prior_snap_id_res.scalar.return_value = None  # No prior close

    # ── Mock 5: Snapshot count query ─────────────────────────────────
    mock_snap_count_res = MagicMock()
    mock_snap_count_res.scalar.return_value = 78

    # Chain all mock execute results in call order
    # Since query_date is passed, the date-resolution query is SKIPPED.
    # Remaining order: 1. spot, 2. flow LAG, 3. prior snap ID, 4. snap count
    mock_execute.side_effect = [
        mock_spot_res,          # 1. Spot price query
        mock_flow_res,          # 2. Main LAG window flow query
        mock_prior_snap_id_res, # 3. Prior close snapshot ID
        mock_snap_count_res,    # 4. Snapshot count
    ]

    service = OptionsNetFlowService(mock_db)
    response = await service.get_net_flow_data("TSLA", "2026-06-30", spot_percent=15.0)

    assert response["success"] is True
    assert response["ticker"] == "TSLA"
    assert response["date"] == "2026-06-30"
    assert response["spotPrice"] == 100.50
    assert len(response["data"]) == 1

    strike_res = response["data"][0]
    assert strike_res["strike"] == 105.0
    assert strike_res["type"] == "C"
    # Volume 25 bought, 0 written → net +25
    assert strike_res["boughtVolume"] == 25.0
    assert strike_res["writtenVolume"] == 0.0
    assert strike_res["netContracts"] == 25.0
    # netPremium = 25 * 1.27 * 100 = 3175.0
    assert abs(strike_res["netPremium"] - 3175.0) < 0.01
