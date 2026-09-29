"""
India GEX API Router.

Endpoints for India-specific Gamma Exposure data:
  - /api/india/gex         — Dealer-weighted GEX analysis
  - /api/india/weights     — Current dealer positioning weights
  - /api/india/instruments — Available instruments and lot sizes
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import Optional, List, Dict, Any
from datetime import datetime, date
import numpy as np

from app.database import get_db
from app.services.greeks.india_engine import IndiaGEXEngine
from app.services.ingestion.nse_participant import NSEParticipantParser
from app.models.quant import ParticipantOIDaily
from app.models.option_snapshot import OptionSnapshot, OptionData
from core.ipf_deconstructor import IPFDeconstructor, PARTICIPANTS
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


# ─────────────────────────────────────────────────────────────────────────────
# Participant Positioning & Historical Flow Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/participants/history")
async def get_participant_history(
    start_date: Optional[str] = Query("2026-01-01", description="Start date (YYYY-MM-DD)"),
    limit: int = Query(300, description="Max daily records to return"),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the historical daily participant positioning time-series.
    Includes Client, DII, FII, and Pro breakdowns for Futures, Calls, and Puts,
    as well as FII Long/Short ratio.
    """
    parsed_date = None
    if start_date:
        try:
            parsed_date = datetime.strptime(start_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format (YYYY-MM-DD)")

    history = await NSEParticipantParser.get_participant_history(db, start_date=parsed_date, limit=limit)
    return {
        "success": True,
        "count": len(history),
        "data": history,
    }


@router.get("/participants/daily-summary")
async def get_participant_daily_summary(
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the latest daily EOD change update card:
    - Today's positions vs previous trading day ΔOI for FII, Pro, Client, and DII
    - FII Futures Long/Short ratio and sentiment regime
    - Quantitative flow commentary
    """
    summary = await NSEParticipantParser.get_daily_eod_summary(db)
    if not summary:
        raise HTTPException(
            status_code=404,
            detail="No participant data found in database. Please run backfill.",
        )

    return {
        "success": True,
        "data": summary,
    }


@router.post("/participants/backfill")
async def trigger_participant_backfill(
    start_date: Optional[str] = Query("2026-01-01", description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD, defaults to today)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger backfilling of NSE historical participant data from NSE Archives.
    """
    try:
        s_date = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else date(2026, 1, 1)
        e_date = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format (expected YYYY-MM-DD)")

    parser = NSEParticipantParser(db)
    res = await parser.backfill_historical_participant_oi(start_date=s_date, end_date=e_date)
    return res


# ─────────────────────────────────────────────────────────────────────────────
# Phase 3: Live Strike-Level Position Deconstruction via IPF
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/gex/ipf-deconstruction")
async def get_live_ipf_deconstruction(
    ticker: str = Query("NIFTY", description="Indian symbol: NIFTY, BANKNIFTY, SENSEX"),
    expiry: Optional[str] = Query(None, description="Expiry date filter (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Recovers the unobservable strike-by-strike participant distribution matrix X_{k, p}
    using Iterative Proportional Fitting (Sinkhorn-Knopp) on the latest live option chain.
    Returns granular Net Dealer Gamma per strike without crude global scalar heuristics.
    """
    ticker = ticker.upper()
    if not is_india_symbol(ticker):
        raise HTTPException(status_code=400, detail=f"Unsupported ticker: {ticker}")

    instrument = get_instrument(ticker)
    lot_size = instrument["lot_size"] if instrument else 25

    # 1. Get latest option snapshot from DB
    snap_stmt = (
        select(OptionSnapshot)
        .where(OptionSnapshot.ticker == ticker)
        .order_by(desc(OptionSnapshot.timestamp))
        .limit(1)
    )
    snap_res = await db.execute(snap_stmt)
    snapshot = snap_res.scalar_one_or_none()

    if not snapshot:
        raise HTTPException(status_code=404, detail=f"No option snapshot found for {ticker}")

    spot = float(snapshot.spot_price)

    # 2. Get option contracts
    opts_stmt = (
        select(OptionData)
        .where(OptionData.snapshot_id == snapshot.id)
        .order_by(OptionData.strike)
    )
    if expiry:
        try:
            exp_date = datetime.strptime(expiry, "%Y-%m-%d").date()
            opts_stmt = opts_stmt.where(OptionData.expiration == exp_date)
        except ValueError:
            pass

    opts_res = await db.execute(opts_stmt)
    contracts = opts_res.scalars().all()

    if not contracts:
        raise HTTPException(status_code=404, detail=f"No contracts available for snapshot {snapshot.id}")

    # 3. Aggregate unique strikes and calculate DTE
    strike_map: Dict[float, Dict[str, Any]] = {}
    sample_exp = None

    for c in contracts:
        s = float(c.strike)
        if s not in strike_map:
            strike_map[s] = {"ce_oi": 0.0, "pe_oi": 0.0, "ce_iv": 0.15, "pe_iv": 0.15, "gamma": 0.0}
        
        opt_type = (c.option_type or "").upper()
        oi = float(c.open_interest or 0)
        iv = float(c.implied_volatility or 0)
        gamma = float(c.gamma or 0)

        if opt_type.startswith("C"):
            strike_map[s]["ce_oi"] += oi
            if iv > 0:
                strike_map[s]["ce_iv"] = iv
            if gamma > 0:
                strike_map[s]["gamma"] = gamma
        else:
            strike_map[s]["pe_oi"] += oi
            if iv > 0:
                strike_map[s]["pe_iv"] = iv
            if gamma > 0 and strike_map[s]["gamma"] == 0:
                strike_map[s]["gamma"] = gamma

        if sample_exp is None and c.expiration:
            sample_exp = c.expiration

    sorted_strikes = sorted(strike_map.keys())
    # Filter out empty or deep noise strikes (> 20% away from spot with 0 OI)
    relevant_strikes = [
        s for s in sorted_strikes
        if (strike_map[s]["ce_oi"] > 0 or strike_map[s]["pe_oi"] > 0)
        and (0.85 * spot <= s <= 1.15 * spot)
    ]
    if not relevant_strikes:
        relevant_strikes = sorted_strikes

    dte = 3.0
    if sample_exp:
        dte = max(0.5, (sample_exp - date.today()).days)

    strikes_arr = relevant_strikes
    ce_oi_arr = np.array([strike_map[s]["ce_oi"] for s in strikes_arr], dtype=float)
    pe_oi_arr = np.array([strike_map[s]["pe_oi"] for s in strikes_arr], dtype=float)
    ce_iv_arr = [strike_map[s]["ce_iv"] for s in strikes_arr]
    pe_iv_arr = [strike_map[s]["pe_iv"] for s in strikes_arr]
    gamma_arr = np.array([strike_map[s]["gamma"] for s in strikes_arr], dtype=float)

    # 4. Get latest participant EOD data
    p_stmt = select(ParticipantOIDaily).order_by(desc(ParticipantOIDaily.date)).limit(1)
    p_res = await db.execute(p_stmt)
    latest_p = p_res.scalar_one_or_none()

    if not latest_p:
        raise HTTPException(status_code=404, detail="No participant EOD records found")

    participant_eod = {
        "Client": {
            "call_long": float(latest_p.client_call_long),
            "call_short": float(latest_p.client_call_short),
            "put_long": float(latest_p.client_put_long),
            "put_short": float(latest_p.client_put_short),
        },
        "DII": {
            "call_long": float(latest_p.dii_call_long),
            "call_short": float(latest_p.dii_call_short),
            "put_long": float(latest_p.dii_put_long),
            "put_short": float(latest_p.dii_put_short),
        },
        "FII": {
            "call_long": float(latest_p.fii_call_long),
            "call_short": float(latest_p.fii_call_short),
            "put_long": float(latest_p.fii_put_long),
            "put_short": float(latest_p.fii_put_short),
        },
        "Pro": {
            "call_long": float(latest_p.pro_call_long),
            "call_short": float(latest_p.pro_call_short),
            "put_long": float(latest_p.pro_put_long),
            "put_short": float(latest_p.pro_put_short),
        },
    }

    # 5. Run IPF Deconstruction
    deconstructor = IPFDeconstructor(max_iter=500, tol=1e-5)
    ipf_result = deconstructor.deconstruct_full_chain(
        strikes=strikes_arr,
        spot=spot,
        dte=dte,
        ce_oi=ce_oi_arr,
        pe_oi=pe_oi_arr,
        ce_iv=ce_iv_arr,
        pe_iv=pe_iv_arr,
        participant_eod=participant_eod,
        gammas=gamma_arr,
    )

    # Convert gamma to INR Crores per 1% spot move
    crore = 1e7
    for s_item in ipf_result.get("strikes", []):
        raw_g = s_item["dealer_gamma"]
        s_item["gex_crores"] = round((raw_g * spot * 0.01 * spot * lot_size) / crore, 4)

    total_crores = round(sum(s["gex_crores"] for s in ipf_result.get("strikes", [])), 2)
    ipf_result["net_dealer_gex_crores"] = total_crores
    ipf_result["gamma_regime"] = "POSITIVE" if total_crores >= 0 else "NEGATIVE"
    ipf_result["ticker"] = ticker
    ipf_result["lot_size"] = lot_size
    ipf_result["participant_date"] = latest_p.date.isoformat()

    return {
        "success": True,
        "data": ipf_result,
    }

