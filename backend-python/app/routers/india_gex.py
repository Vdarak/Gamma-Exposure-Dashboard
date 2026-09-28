"""
India GEX API Router.

Endpoints for India-specific Gamma Exposure data:
  - /api/india/gex         — Dealer-weighted GEX analysis
  - /api/india/weights     — Current dealer positioning weights
  - /api/india/instruments — Available instruments and lot sizes
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import get_db
from app.services.greeks.india_engine import IndiaGEXEngine
from app.services.ingestion.nse_participant import NSEParticipantParser
from app.config import get_all_india_symbols, get_instrument, is_india_symbol

router = APIRouter(prefix="/api/india")


@router.get("/gex")
async def get_india_gex(
    ticker: str = Query(..., description="Indian index symbol (NIFTY, BANKNIFTY, SENSEX)"),
    expiry: Optional[str] = Query(None, description="Optional expiry filter (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns India-specific GEX analysis with dealer positioning weights.

    The response includes:
      - Dealer-weighted GEX per strike (INR Crores per 1% spot move)
      - Total net GEX and gamma regime (positive/negative)
      - Gamma flip point (interpolated)
      - Raw dealer weights (ω_CE, ω_PE)
      - Available expiries
    """
    ticker = ticker.upper()
    if not is_india_symbol(ticker):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported India ticker: {ticker}. "
                   f"Supported: {', '.join(get_all_india_symbols())}",
        )

    engine = IndiaGEXEngine(db)
    result = await engine.calculate_gex(ticker=ticker, expiry=expiry)

    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No option data available for {ticker}. "
                   f"Data may not have been collected yet.",
        )

    return {
        "success": True,
        "data": result,
    }


@router.get("/weights")
async def get_dealer_weights(
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the current dealer positioning weights (ω_CE, ω_PE).

    These are computed daily from NSE Participant-Wise Open Interest data.
    If no weights are available, fallback values are returned.
    """
    weights = await NSEParticipantParser.get_latest_weights(db)
    return {
        "success": True,
        "data": weights,
    }


@router.post("/weights/refresh")
async def refresh_dealer_weights(
    db: AsyncSession = Depends(get_db),
):
    """
    Manually trigger a refresh of dealer positioning weights from NSE Archives.
    Useful for testing or if the scheduled job missed a run.
    """
    parser = NSEParticipantParser(db)
    result = await parser.fetch_and_calculate_weights()

    if result is None:
        raise HTTPException(
            status_code=502,
            detail="Failed to fetch NSE participant data. "
                   "The exchange may be closed or the data not yet published.",
        )

    return {
        "success": True,
        "data": result,
        "message": "Dealer weights refreshed successfully.",
    }


@router.get("/instruments")
async def get_instruments():
    """
    Returns all configured Indian instruments with lot sizes, strike steps, and metadata.
    """
    symbols = get_all_india_symbols()
    instruments = {}
    for sym in symbols:
        inst = get_instrument(sym)
        if inst:
            instruments[sym] = inst

    return {
        "success": True,
        "data": instruments,
    }


@router.get("/dhan/expiries")
async def get_dhan_expiries(
    ticker: str = Query(..., description="Indian symbol: NIFTY, BANKNIFTY, SENSEX")
):
    """
    Direct verification endpoint: returns live available expiries directly from DhanHQ API.
    """
    ticker = ticker.upper()
    if not is_india_symbol(ticker):
        raise HTTPException(status_code=400, detail=f"Unsupported ticker {ticker}")

    from app.services.ingestion.dhan_client import DhanOptionChainClient
    client = DhanOptionChainClient()
    sec_id = client.INDEX_SCRIP_MAP.get(ticker)
    inst = get_instrument(ticker)
    underlying_seg = inst.get("underlying_seg", "IDX_I") if inst else "IDX_I"

    try:
        dhan = client._get_dhan()
        res = dhan.expiry_list(under_security_id=sec_id, under_exchange_segment=underlying_seg)
        return {
            "success": True,
            "source": "DhanHQ v2 Live API",
            "ticker": ticker,
            "security_id": sec_id,
            "exchange_segment": underlying_seg,
            "data": res.get("data", {}).get("data", []) if isinstance(res, dict) else res,
            "raw_response": res
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Dhan API error: {str(e)}")


@router.get("/dhan/chain")
async def get_dhan_option_chain(
    ticker: str = Query(..., description="Indian symbol: NIFTY, BANKNIFTY, SENSEX"),
    expiry: Optional[str] = Query(None, description="Expiry date (YYYY-MM-DD). Defaults to nearest."),
    raw: bool = Query(False, description="If true, returns raw unedited JSON response from DhanHQ"),
):
    """
    Dedicated inspection endpoint to verify that real live options data is being sourced directly from DhanHQ.
    Returns spot price, strike count, Greeks, and live contracts.
    """
    ticker = ticker.upper()
    if not is_india_symbol(ticker):
        raise HTTPException(status_code=400, detail=f"Unsupported ticker {ticker}")

    from app.services.ingestion.dhan_client import DhanOptionChainClient
    client = DhanOptionChainClient()
    sec_id = client.INDEX_SCRIP_MAP.get(ticker)
    inst = get_instrument(ticker)
    underlying_seg = inst.get("underlying_seg", "IDX_I") if inst else "IDX_I"

    try:
        dhan = client._get_dhan()

        # Get expiries if not provided
        if not expiry:
            exp_res = dhan.expiry_list(under_security_id=sec_id, under_exchange_segment=underlying_seg)
            if isinstance(exp_res, dict) and exp_res.get("status") == "success":
                exps = exp_res.get("data", {}).get("data", [])
                if exps:
                    expiry = exps[0]

        if not expiry:
            raise HTTPException(status_code=404, detail="Could not retrieve expiries from DhanHQ")

        res = dhan.option_chain(
            under_security_id=sec_id,
            under_exchange_segment=underlying_seg,
            expiry=expiry,
        )

        if raw:
            return res

        data = res.get("data", {})
        if isinstance(data, dict) and "data" in data:
            data = data["data"]

        spot_price = float(data.get("last_price", 0) if isinstance(data, dict) else 0)
        oc = data.get("oc", {}) if isinstance(data, dict) else {}

        # Format strikes nicely for verification
        strikes_summary = []
        for strike_str, details in sorted(oc.items(), key=lambda x: float(x[0])):
            s = float(strike_str)
            ce = details.get("ce", {})
            pe = details.get("pe", {})
            strikes_summary.append({
                "strike": s,
                "distance_from_spot": round(s - spot_price, 2),
                "ce": {
                    "last_price": ce.get("last_price", 0),
                    "open_interest": ce.get("oi", 0),
                    "volume": ce.get("volume", 0),
                    "iv": ce.get("implied_volatility", 0),
                    "greeks": ce.get("greeks", {}),
                },
                "pe": {
                    "last_price": pe.get("last_price", 0),
                    "open_interest": pe.get("oi", 0),
                    "volume": pe.get("volume", 0),
                    "iv": pe.get("implied_volatility", 0),
                    "greeks": pe.get("greeks", {}),
                }
            })

        return {
            "success": True,
            "source": "DhanHQ v2 Live API",
            "ticker": ticker,
            "security_id": sec_id,
            "exchange_segment": underlying_seg,
            "spot_price": spot_price,
            "expiry": expiry,
            "total_strikes": len(strikes_summary),
            "strikes": strikes_summary
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Dhan API error: {str(e)}")
