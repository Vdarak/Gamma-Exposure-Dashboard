import pytest
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool
from app.config import settings
from app.database import Base

@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for each test case."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(scope="session")
async def db_engine():
    """Session-scoped engine to avoid event loop mismatch across tests."""
    db_url = settings.database_url
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        
    engine = create_async_engine(db_url, poolclass=NullPool, future=True)
    yield engine
    await engine.dispose()

@pytest.fixture
async def db_session(db_engine):
    """
    Yields an async session mapped to a transaction that rolls back after each test.
    Guarantees that database records are rolled back after each test.
    """
    async_session_factory = async_sessionmaker(
        bind=db_engine,
        class_=AsyncSession,
        expire_on_commit=False
    )
    async with db_engine.connect() as connection:
        transaction = await connection.begin()
        session = async_session_factory(bind=connection)
        
        yield session
        
        await session.close()
        await transaction.rollback()

@pytest.fixture(autouse=True)
async def override_get_db(db_engine):
    """Overwrites get_db dependency and database module globals to use the test engine."""
    from app.main import app as fastapi_app
    from app.database import get_db
    import app.database as app_db
    
    # Save original globals
    orig_engine = app_db.engine
    orig_session_local = app_db.AsyncSessionLocal
    
    # Apply override engine
    app_db.engine = db_engine
    app_db.AsyncSessionLocal = async_sessionmaker(
        bind=db_engine,
        class_=AsyncSession,
        expire_on_commit=False
    )
    
    async def _get_db_override():
        async with app_db.AsyncSessionLocal() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()
                
    fastapi_app.dependency_overrides[get_db] = _get_db_override
    yield
    
    # Restore originals
    fastapi_app.dependency_overrides.clear()
    app_db.engine = orig_engine
    app_db.AsyncSessionLocal = orig_session_local
