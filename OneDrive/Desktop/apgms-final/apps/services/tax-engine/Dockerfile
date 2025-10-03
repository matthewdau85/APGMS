# apps/services/tax-engine/Dockerfile
FROM python:3.11-slim

# OS deps: curl for healthcheck; build-essential for compiling wheels when needed
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl build-essential \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    UVICORN_PORT=8002 \
    SERVICE_PORT=8002 \
    PORT=8002

WORKDIR /app

# Copy the service code first (this also brings requirements.txt if you have it)
COPY . /app

# Install deps: prefer requirements.txt if present; otherwise install sensible defaults
RUN python -m pip install --upgrade pip setuptools wheel && \
    if [ -f requirements.txt ]; then \
      pip install -r requirements.txt; \
    else \
      pip install \
        "uvicorn[standard]" \
        fastapi \
        pydantic \
        httpx \
        nats-py \
        prometheus-client \
        orjson; \
    fi

EXPOSE 8002

# Expect FastAPI app at app/main.py with variable "app"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
