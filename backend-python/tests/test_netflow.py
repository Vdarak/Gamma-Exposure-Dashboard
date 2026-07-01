import pytest
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, date
from decimal import Decimal
from app.services.flow.netflow import OptionsNetFlowService

@pytest.mark.asyncio
async def test_options_net_flow_service_with_mock_db():
    # 1. Setup mock DB session
    mock_db = AsyncMock()

    # Mock snapshots query result
    mock_snap_1 = MagicMock()
    mock_snap_1.id = 1
    mock_snap_1.timestamp = datetime(2026, 6, 30, 9, 30, 0)
    mock_snap_1.spot_price = Decimal("100.00")

    mock_snap_2 = MagicMock()
    mock_snap_2.id = 2
    mock_snap_2.timestamp = datetime(2026, 6, 30, 9, 35, 0)
    mock_snap_2.spot_price = Decimal("100.50")

    mock_execute = AsyncMock()
    mock_db.execute = mock_execute

    # Set up results
    mock_snaps_res = MagicMock()
    mock_snaps_res.scalars.return_value.all.return_value = [mock_snap_1, mock_snap_2]

    # Mock option data for S1
    mock_opt_s1_c105 = MagicMock()
    mock_opt_s1_c105.snapshot_id = 1
    mock_opt_s1_c105.strike = Decimal("105.00")
    mock_opt_s1_c105.option_type = "C"
    mock_opt_s1_c105.expiration = date(2026, 7, 2)
    mock_opt_s1_c105.last_price = Decimal("1.20")
    mock_opt_s1_c105.volume = 10
    mock_opt_s1_c105.open_interest = 100
    mock_opt_s1_c105.implied_volatility = Decimal("0.25")
    mock_opt_s1_c105.bid = Decimal("1.15")
    mock_opt_s1_c105.ask = Decimal("1.25")

    # Mock option data for S2
    mock_opt_s2_c105 = MagicMock()
    mock_opt_s2_c105.snapshot_id = 2
    mock_opt_s2_c105.strike = Decimal("105.00")
    mock_opt_s2_c105.option_type = "C"
    mock_opt_s2_c105.expiration = date(2026, 7, 2)
    # Price rises closer to Ask (1.27 > midpoint of 1.18 and 1.28) -> Buyer-initiated!
    mock_opt_s2_c105.last_price = Decimal("1.27")
    mock_opt_s2_c105.volume = 35 # volume increased by 25
    mock_opt_s2_c105.open_interest = 120
    mock_opt_s2_c105.implied_volatility = Decimal("0.26")
    mock_opt_s2_c105.bid = Decimal("1.18")
    mock_opt_s2_c105.ask = Decimal("1.28")

    # Mock option data result containing all contracts for target day snapshots
    mock_opts_res = MagicMock()
    mock_opts_res.scalars.return_value.all.return_value = [mock_opt_s1_c105, mock_opt_s2_c105]

    mock_prior_snap_res = MagicMock()
    mock_prior_snap_res.scalar_one_or_none.return_value = None

    # Chain mock returns
    # Since query_date is passed, the latest date query is SKIPPED.
    # 1. Snapshots list query
    # 2. All day option contracts in_ query
    # 3. Prior EOD close snapshot query
    mock_execute.side_effect = [
        mock_snaps_res,      # Snapshots list
        mock_opts_res,       # All day option contracts (in_ query)
        mock_prior_snap_res  # Prior EOD close snapshot
    ]

    # Initialize service
    service = OptionsNetFlowService(mock_db)
    response = await service.get_net_flow_data("TSLA", "2026-06-30")

    assert response["success"] is True
    assert response["ticker"] == "TSLA"
    assert response["date"] == "2026-06-30"
    assert response["spotPrice"] == 100.50
    assert len(response["data"]) == 1

    strike_res = response["data"][0]
    assert strike_res["strike"] == 105.0
    assert strike_res["type"] == "C"
    # Volume delta is 25. Midpoint is 1.23. Last price is 1.27.
    # Since 1.27 > 1.23, it is classified as BOUGHT.
    assert strike_res["boughtVolume"] == 25.0
    assert strike_res["writtenVolume"] == 0.0
    assert strike_res["netContracts"] == 25.0
    assert strike_res["netPremium"] == 25.0 * 1.27 * 100.0
