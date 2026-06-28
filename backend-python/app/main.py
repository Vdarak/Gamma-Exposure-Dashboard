from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import engine

from app.services.ingestion import IngestionScheduler

# Setup logging
logging.basicConfig(level=getattr(logging, settings.log_level))
logger = logging.getLogger("gamma-exposure-backend")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Verify database connection
    logger.info("Starting up FastAPI application...")
    try:
        async with engine.connect() as conn:
            logger.info("Successfully connected to the database.")
    except Exception as e:
        logger.error(f"Failed to connect to the database: {e}")
        
    # Start scheduler
    try:
        scheduler = IngestionScheduler()
        scheduler.start()
        app.state.scheduler = scheduler
    except Exception as e:
        logger.error(f"Failed to start scheduler: {e}")
        
    yield
    # Shutdown
    logger.info("Shutting down FastAPI application...")
    await engine.dispose()

app = FastAPI(
    title=settings.app_name,
    description="Python Backend for Gamma Exposure & Volatility Indicator Dashboard",
    version="2.0.0",
    lifespan=lifespan
)

# CORS middleware configuration
origins = [
    settings.frontend_url.rstrip("/"),
    "http://localhost:3000",
    "http://localhost:3001",
    "https://gamma-exposure-dashboard.vercel.app"
]

# Allow any Vercel domain or sub-domain, as well as localhost on any port
allow_origin_regex = r"https://.*\.vercel\.app|http://localhost:\d+"

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health router
health_router = APIRouter()

@health_router.get("/health")
@health_router.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "environment": settings.environment,
        "app_name": settings.app_name,
        "version": "2.0.0"
    }

app.include_router(health_router)

# Import other routers
from app.routers.options import router as options_router
from app.routers.quant import router as quant_router
from app.routers.journal import router as journal_router
from app.routers.waitlist import router as waitlist_router
from app.routers.backtest import router as backtest_router
from app.routers.ai import router as ai_router
from app.routers.ml import router as ml_router

# Include routers
app.include_router(options_router)
app.include_router(quant_router)
app.include_router(journal_router)
app.include_router(waitlist_router)
app.include_router(backtest_router)
app.include_router(ai_router)
app.include_router(ml_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port, reload=True)
