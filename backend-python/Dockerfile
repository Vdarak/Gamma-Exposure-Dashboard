# Use official Python 3.12 slim base image
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

# Set working directory
WORKDIR /app

# Install system dependencies (including gcc and libomp for XGBoost)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    libomp-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy pyproject.toml and project description first for dependency caching
COPY pyproject.toml /app/

# Install python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir .

# Copy application source code
COPY app /app/app
COPY alembic /app/alembic
COPY alembic.ini /app/

# Expose backend port
EXPOSE 8000

# Start FastAPI application via uvicorn
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
