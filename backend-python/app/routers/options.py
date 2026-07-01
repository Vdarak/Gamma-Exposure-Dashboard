from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from typing import Optional, List, Dict, Any
from app.database import get_db
from app.services.data_retrieval import DataRetrievalService
from app.services.flow.service import OptionsFlowService, OptionsFlowResponse
from app.services.ingestion.saver import DataSaverService

router = APIRouter(prefix="/api")

@router.get("/current-data")
async def get_current_data(
    ticker: str = Query(..., description="Ticker symbol (e.g. SPX)"),
    db: AsyncSession = Depends(get_db)
):
    retrieval = DataRetrievalService(db)
    data = await retrieval.get_current_data(ticker)
    
    if not data:
        # Trigger on-demand scrape
        from app.services.ingestion.cboe import CBOEScraperService
        from app.services.ingestion.nse_live import NSELiveScraperService
        
        ticker_upper = ticker.upper()
        is_index = ticker_upper in {"NIFTY", "BANKNIFTY", "RELIANCE"}
        scraper = NSELiveScraperService() if is_index else CBOEScraperService()
        snap = await scraper.get_normalized_snapshot(ticker_upper)
        
        if snap:
            saver = DataSaverService(db)
            await saver.save_snapshot(snap)
            data = await retrieval.get_current_data(ticker_upper)

    if not data:
        raise HTTPException(status_code=404, detail=f"No data found for ticker {ticker}")

    return {
        "success": True,
        "data": data,
        "timestamp": datetime.utcnow().isoformat()
    }

@router.get("/historical-data")
async def get_historical_data(
    ticker: str = Query(...),
    hoursBack: Optional[int] = Query(None),
    startDate: Optional[str] = Query(None),
    endDate: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    start = datetime.fromisoformat(startDate) if startDate else None
    end = datetime.fromisoformat(endDate) if endDate else None

    retrieval = DataRetrievalService(db)
    data = await retrieval.get_historical_data(ticker, hours_back=hoursBack, start_date=start, end_date=end)

    return {
        "success": True,
        "data": data
    }

@router.get("/timestamps")
async def get_timestamps(
    ticker: str = Query(...),
    days: int = Query(3),
    db: AsyncSession = Depends(get_db)
):
    retrieval = DataRetrievalService(db)
    data = await retrieval.get_available_timestamps(ticker, days_back=days)
    return {
        "success": True,
        "data": data
    }

@router.get("/stats")
async def get_stats(
    ticker: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    retrieval = DataRetrievalService(db)
    data = await retrieval.get_data_statistics(ticker)
    return {
        "success": True,
        "data": data
    }

@router.get("/expiries")
async def get_expiries(
    ticker: str = Query(...),
    timestamp: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    ts = datetime.fromisoformat(timestamp) if timestamp else None
    retrieval = DataRetrievalService(db)
    data = await retrieval.get_available_expiries(ticker, ts)
    return {
        "success": True,
        "data": data,
        "count": len(data),
        "timestamp": datetime.utcnow().isoformat()
    }

@router.get("/options/flow", response_model=OptionsFlowResponse)
async def get_options_flow(
    ticker: str = Query(...),
    timeframe: str = Query("Intraday"),
    startDate: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    flow_service = OptionsFlowService(db)
    response = await flow_service.get_options_flow_data(ticker, timeframe, startDate)
    return response

@router.get("/options/netflow")
async def get_options_netflow(
    ticker: str = Query(...),
    date: Optional[str] = Query(None),
    spotPercent: float = Query(15.0, ge=1.0, le=50.0, description="±% range of spot price to include strikes for"),
    db: AsyncSession = Depends(get_db)
):
    from app.services.flow.netflow import OptionsNetFlowService
    service = OptionsNetFlowService(db)
    response = await service.get_net_flow_data(ticker, date, spot_percent=spotPercent)
    return response

@router.post("/collect-now")
async def collect_now(db: AsyncSession = Depends(get_db)):
    """Manual trigger to run scheduler and fetch data for all active markets."""
    from app.services.ingestion.scheduler import IngestionScheduler
    scheduler = IngestionScheduler()
    await scheduler.collect_live_data()
    return {
        "success": True,
        "message": "Market data collection triggered successfully"
    }

@router.get("/db-diagnostics")
async def db_diagnostics(db: AsyncSession = Depends(get_db)):
    import sqlalchemy as sa
    try:
        # 1. Check DB Size
        db_size_res = await db.execute(sa.text("SELECT pg_size_pretty(pg_database_size(current_database()))"))
        db_size = db_size_res.scalar()
        
        # 2. Check counts and sizes
        snapshots_count_res = await db.execute(sa.text("SELECT COUNT(*) FROM option_snapshots"))
        snapshots_count = snapshots_count_res.scalar()
        
        options_count_res = await db.execute(sa.text("SELECT COUNT(*) FROM option_data"))
        options_count = options_count_res.scalar()
        
        options_size_res = await db.execute(sa.text("SELECT pg_size_pretty(pg_total_relation_size('option_data'))"))
        options_size = options_size_res.scalar()
        
        # 3. Test database write capability
        write_status = "SUCCESS"
        write_test_error = None
        try:
            # We use a rollback transaction so we don't pollute database
            await db.execute(sa.text("INSERT INTO waitlist_signups (email, tier, status) VALUES ('test_diag@diag.com', 'Free', 'pending')"))
            await db.flush()
            await db.rollback()
        except Exception as write_err:
            write_status = "FAILED"
            write_test_error = str(write_err)
            try:
                await db.rollback()
            except:
                pass
            
        return {
            "success": True,
            "database_size": db_size,
            "option_snapshots_count": snapshots_count,
            "option_data_count": options_count,
            "option_data_table_size": options_size,
            "write_status": write_status,
            "write_error": write_test_error
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }
