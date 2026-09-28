#!/bin/sh
set -e

echo "=== Starting Gamma Exposure Backend ==="

# Wait for postgres if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
    echo "Waiting for PostgreSQL database to be reachable..."
    python -c "
import time, os, sys
import urllib.parse
from sqlalchemy import create_engine

url = os.environ.get('DATABASE_URL', '')
if '+asyncpg' in url:
    url = url.replace('+asyncpg', '')
if url.startswith('postgresql://'):
    pass

for attempt in range(30):
    try:
        engine = create_engine(url)
        with engine.connect() as conn:
            print('PostgreSQL is ready!')
            sys.exit(0)
    except Exception as e:
        print(f'Attempt {attempt+1}/30: DB not ready yet ({e}), waiting 2s...')
        time.sleep(2)

print('PostgreSQL did not become ready in time.')
" || echo "Database check finished."
fi

# Run Alembic migrations
echo "Running database migrations with Alembic..."
alembic upgrade head || echo "⚠️ Alembic migration encountered an error or already up to date, continuing startup..."

# Start Uvicorn server
echo "Starting Uvicorn server on port ${PORT:-8000}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
