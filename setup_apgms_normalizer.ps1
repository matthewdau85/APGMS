# Run in PowerShell from your repo root:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\setup_apgms_normalizer.ps1

$ErrorActionPreference = "Stop"

function Backup-File {
  param([string]$Path)
  if (Test-Path $Path) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    Copy-Item $Path "$Path.bak-$stamp" -Force
    Write-Host "Backed up $Path -> $Path.bak-$stamp"
  }
}

# --- 0) Ensure directories exist ---
New-Item -ItemType Directory -Force -Path ops, scripts, "apps/services/event-normalizer", "libs/schemas/json" | Out-Null

# --- 1) requirements.txt (pinned, deduped) ---
Backup-File "requirements.txt"
@'
fastapi==0.115.0
uvicorn[standard]==0.30.6
pydantic==2.9.2
orjson==3.10.7
nats-py==2.7.2
prometheus-client==0.20.0
httpx==0.27.2
'@ | Set-Content -NoNewline -Encoding UTF8 "requirements.txt"
Write-Host "Wrote requirements.txt"

# --- 2) .dockerignore ---
Backup-File ".dockerignore"
@'
**/__pycache__/
**/*.pyc
**/*.pyo
**/*.pyd
*.pkl
*.db
*.sqlite
.env
.venv
.git
.gitignore
.idea
.vscode
dist
build
node_modules
__pycache__
'@ | Set-Content -NoNewline -Encoding UTF8 ".dockerignore"
Write-Host "Wrote .dockerignore"

# --- 3) Dockerfile (minimal, non-root, single pip layer) ---
Backup-File "Dockerfile"
@'
FROM python:3.11-slim

# Minimal system deps; add build tools only if you compile wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy app code (adjust paths only if your layout changes)
COPY apps/services/event-normalizer/app ./app
COPY apps/services/event-normalizer/run_normalizer.py /app/run_normalizer.py
COPY libs/json ./libs/schemas/json

# Install python deps (pinned)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Security: run as non-root
RUN useradd -m appuser
USER appuser

EXPOSE 8001
# Ensure app.main:app exists in your repo
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
'@ | Set-Content -NoNewline -Encoding UTF8 "Dockerfile"
Write-Host "Wrote Dockerfile"

# --- 4) docker-compose (nats, normalizer, exporter, prometheus) ---
$composeFile = if (Test-Path "docker-compose.yml") { "docker-compose.yml" } else { "docker-compose.yaml" }
Backup-File $composeFile
@'
services:
  nats:
    image: nats:2
    command: ["-js", "-m", "8222"] # JetStream + monitoring
    ports:
      - "4222:4222"
      - "8222:8222"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8222/varz"]
      interval: 10s
      timeout: 3s
      retries: 20

  normalizer:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      NATS_URL: nats://nats:4222
    depends_on:
      nats:
        condition: service_healthy
    ports:
      - "8001:8001"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8001/readyz || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 20
    deploy:
      resources:
        limits:
          cpus: "0.50"
          memory: 512M
        reservations:
          cpus: "0.10"
          memory: 128M

  nats-exporter:
    image: natsio/prometheus-nats-exporter:latest
    command: ["-varz", "http://nats:8222", "-connz", "http://nats:8222", "-routez", "http://nats:8222", "-subz", "http://nats:8222"]
    depends_on:
      nats:
        condition: service_healthy
    ports:
      - "7777:7777"

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./ops/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports:
      - "9090:9090"
    depends_on:
      normalizer:
        condition: service_started
      nats-exporter:
        condition: service_started
'@ | Set-Content -NoNewline -Encoding UTF8 $composeFile
Write-Host "Wrote $composeFile"

# --- 5) Dev override (hot reload) ---
Backup-File "docker-compose.dev.yaml"
@'
services:
  normalizer:
    command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]
    volumes:
      - ./apps/services/event-normalizer/app:/app/app
      - ./libs/json:/app/libs/schemas/json
'@ | Set-Content -NoNewline -Encoding UTF8 "docker-compose.dev.yaml"
Write-Host "Wrote docker-compose.dev.yaml"

# --- 6) Prometheus config ---
Backup-File "ops/prometheus.yml"
@'
global:
  scrape_interval: 10s
  evaluation_interval: 10s

scrape_configs:
  - job_name: "normalizer"
    static_configs:
      - targets: ["normalizer:8001"]
    metrics_path: /metrics

  - job_name: "nats_exporter"
    static_configs:
      - targets: ["nats-exporter:7777"]
'@ | Set-Content -NoNewline -Encoding UTF8 "ops/prometheus.yml"
Write-Host "Wrote ops/prometheus.yml"

# --- 7) Makefile (useful even on Windows if you have make; optional) ---
Backup-File "Makefile"
@'
SHELL := /bin/bash

up:
	@docker compose up -d --build --remove-orphans

up-dev:
	@docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d --build --remove-orphans

down:
	@docker compose down -v

logs:
	@docker compose logs -f normalizer

shell:
	@docker compose exec normalizer /bin/sh -lc 'whoami && python --version && pip list'

rebuild:
	@docker compose build --no-cache normalizer && $(MAKE) up

ps:
	@docker compose ps

fmt:
	@echo "No formatter configured; add ruff/black if desired."
'@ | Set-Content -NoNewline -Encoding UTF8 "Makefile"
Write-Host "Wrote Makefile"

# --- 8) Reference readiness snippet (copy into your app if you want stricter /readyz) ---
New-Item -ItemType Directory -Force -Path "ops/snippets" | Out-Null
Backup-File "ops/snippets/fastapi_readiness_example.py"
@'
"""
Example FastAPI readiness:
- /readyz returns 200 only after NATS connects.
- /metrics exposes prometheus_client metrics.
"""
import asyncio
import os
from fastapi import FastAPI
from prometheus_client import REGISTRY, generate_latest, CONTENT_TYPE_LATEST
from fastapi.responses import Response
import nats

app = FastAPI()
_ready = asyncio.Event()

@app.on_event("startup")
async def startup():
    url = os.getenv("NATS_URL", "nats://nats:4222")
    app.state.nc = await nats.connect(url, reconnect=True, max_reconnect_attempts=-1)
    # TODO: add subscriptions/JetStream setup here
    _ready.set()

@app.on_event("shutdown")
async def shutdown():
    if hasattr(app.state, "nc"):
        await app.state.nc.drain()

@app.get("/readyz")
async def readyz():
    return {"status": "ok"} if _ready.is_set() else Response(status_code=503)

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)
'@ | Set-Content -NoNewline -Encoding UTF8 "ops/snippets/fastapi_readiness_example.py"
Write-Host "Wrote ops/snippets/fastapi_readiness_example.py (reference only)"

Write-Host ""
Write-Host "✅ Done. Next steps:" -ForegroundColor Green
Write-Host "  1) Ensure your ASGI app path 'app.main:app' is correct."
Write-Host "  2) (Optional) Wire /readyz to NATS readiness using the snippet."
Write-Host "  3) Bring the stack up:"
Write-Host "       docker compose up -d --build --remove-orphans"
Write-Host "     (Dev hot-reload):"
Write-Host "       docker compose -f $composeFile -f docker-compose.dev.yaml up -d --build --remove-orphans"

