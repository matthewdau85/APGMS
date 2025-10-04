#!/usr/bin/env bash
set -euo pipefail

ts() { date +"%Y%m%d-%H%M%S"; }
backup() {
  local f="$1"
  if [[ -f "$f" ]]; then
    cp -f "$f" "$f.bak-$(ts)"
    echo "Backed up $f -> $f.bak-$(ts)"
  fi
}

ROOT_DIR="$(pwd)"
echo "Applying normalizer stack hardening in: $ROOT_DIR"

# --- 0) Ensure directories exist ---
mkdir -p ops scripts apps/services/event-normalizer libs/schemas/json

# --- 1) requirements.txt (pinned, deduped) ---
backup requirements.txt
cat > requirements.txt <<'EOF'
fastapi==0.115.0
uvicorn[standard]==0.30.6
pydantic==2.9.2
orjson==3.10.7
nats-py==2.7.2
prometheus-client==0.20.0
httpx==0.27.2
EOF
echo "Wrote requirements.txt"

# --- 2) .dockerignore (keep build context tiny) ---
backup .dockerignore
cat > .dockerignore <<'EOF'
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
EOF
echo "Wrote .dockerignore"

# --- 3) Dockerfile (minimal, non-root, single pip layer) ---
backup Dockerfile
cat > Dockerfile <<'EOF'
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
# Use your app entrypoint here; ensure app.main:app exists
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
EOF
echo "Wrote Dockerfile"

# --- 4) docker-compose.yaml (nats, normalizer, exporter, prometheus) ---
COMPOSE_FILE="docker-compose.yaml"
[[ -f docker-compose.yml ]] && COMPOSE_FILE="docker-compose.yml"  # respect existing name
backup "$COMPOSE_FILE"
cat > "$COMPOSE_FILE" <<'EOF'
services:
  nats:
    image: nats:2
    command: ["-js", "-m", "8222"] # enable JetStream and monitoring on 8222
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
      # Add any additional envs your app needs here
    depends_on:
      nats:
        condition: service_healthy
    ports:
      - "8001:8001"
    healthcheck:
      # Make readiness reflect dependency readiness (app should return 200 only when NATS is connected)
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
EOF
echo "Wrote $COMPOSE_FILE"

# --- 5) Dev profile override for hot-reload (optional) ---
backup docker-compose.dev.yaml
cat > docker-compose.dev.yaml <<'EOF'
services:
  normalizer:
    command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]
    volumes:
      - ./apps/services/event-normalizer/app:/app/app
      - ./libs/json:/app/libs/schemas/json
EOF
echo "Wrote docker-compose.dev.yaml"

# --- 6) Prometheus config (scrape normalizer + nats exporter) ---
backup ops/prometheus.yml
cat > ops/prometheus.yml <<'EOF'
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
EOF
echo "Wrote ops/prometheus.yml"

# --- 7) Makefile QoL targets ---
backup Makefile
cat > Makefile <<'EOF'
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
EOF
echo "Wrote Makefile"

# --- 8) Optional helper: sample readiness stub for FastAPI (if you want it) ---
# We don't overwrite your app, but we provide a snippet you can paste in.
mkdir -p ops/snippets
cat > ops/snippets/fastapi_readiness_example.py <<'EOF'
"""
Example FastAPI readiness pattern:
- Only return 200 when NATS is connected.
- Expose /metrics with prometheus_client (already in your deps).
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
    url = os.getenv("NATS_URL", "nats://localhost:4222")
    app.state.nc = await nats.connect(url, reconnect=True, max_reconnect_attempts=-1)
    # TODO: create subscriptions/JetStream consumers etc.
    _ready.set()

@app.on_event("shutdown")
async def shutdown():
    if hasattr(app.state, "nc"):
        # Drain ensures in-flight messages are handled before closing
        await app.state.nc.drain()

@app.get("/readyz")
async def readyz():
    if _ready.is_set():
        return {"status": "ok"}
    return Response(status_code=503)

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)
EOF
echo "Wrote ops/snippets/fastapi_readiness_example.py (reference only; does not modify your app)"

# --- 9) Final tips & next steps printed out ---
cat <<'OUT'

✅ Done. Files created/updated:
- requirements.txt (pinned)
- .dockerignore
- Dockerfile (minimal, single pip layer, non-root)
- docker-compose.yaml (nats, normalizer, nats-exporter, prometheus + healthchecks)
- docker-compose.dev.yaml (hot-reload bind mounts)
- ops/prometheus.yml (scrape normalizer + nats exporter)
- Makefile (up/down/logs/shell/rebuild helpers)
- ops/snippets/fastapi_readiness_example.py (copy patterns into your app)

Next steps:
1) Ensure your ASGI app path is correct for the CMD in Dockerfile: `app.main:app`.
2) (Recommended) Make /readyz in your FastAPI return 200 only after NATS is connected.
   See ops/snippets/fastapi_readiness_example.py and adapt to your codebase.
3) Bring the stack up cleanly:
   make up
   # or dev mode with hot reload:
   make up-dev

If you previously had stray containers, this will also remove orphans automatically.
OUT
