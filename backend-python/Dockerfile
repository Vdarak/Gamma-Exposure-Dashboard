# Use official Python 3.12 slim base image
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

# Set working directory
WORKDIR /app

# Install system dependencies (gcc, libomp for XGBoost, curl for healthchecks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    libomp-dev \
    python3-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file first for caching
COPY requirements.txt /app/

# Install python dependencies (CPU-only PyTorch to minimize image size and RAM usage)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Copy application source code and migrations
COPY app /app/app
COPY alembic /app/alembic
COPY alembic.ini /app/
COPY entrypoint.sh /app/

RUN chmod +x /app/entrypoint.sh

# Expose backend port
EXPOSE 8000

# Run entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]
