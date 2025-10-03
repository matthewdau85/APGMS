param(
  [string]$RepoRoot = "C:\Users\matth\OneDrive\Desktop\apgms-final"
)
$ErrorActionPreference = 'Stop'

function WNoBom($RelPath, $Content) {
  $Full = Join-Path $RepoRoot $RelPath
  $Dir = Split-Path $Full -Parent
  if (!(Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Full, $Content, $utf8NoBom)
  Write-Host "Wrote $RelPath"
}
function W($RelPath, $Content) { # normal UTF8 is fine for code files
  $Full = Join-Path $RepoRoot $RelPath
  $Dir = Split-Path $Full -Parent
  if (!(Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
  Set-Content -Path $Full -Value $Content -Encoding UTF8
  Write-Host "Wrote $RelPath"
}

# -------------------------------
# Fix docker-compose (remove 'version', ensure services)
# -------------------------------
$compose = @"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: apgms
      POSTGRES_PASSWORD: apgms
      POSTGRES_DB: apgms
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL","pg_isready -U apgms"]
      interval: 5s
      timeout: 5s
      retries: 10

  nats:
    image: nats:2.10
    command: ["-js","-sd","/data"]
    ports: ["4222:4222","8222:8222"]
    healthcheck:
      test: ["CMD","nats","--version"]
      interval: 5s
      timeout: 5s
      retries: 10

  normalizer:
    build: ./apps/services/event-normalizer
    environment:
      NATS_URL: nats://nats:4222
      SERVICE_PORT: "8001"
    ports: ["8001:8001"]
    depends_on:
      nats:
        condition: service_healthy

  tax-engine:
    build: ./apps/services/tax-engine
    environment:
      NATS_URL: nats://nats:4222
      DATABASE_URL: postgresql+psycopg://apgms:apgms@postgres:5432/apgms
      SERVICE_PORT: "8002"
    ports: ["8002:8002"]
    depends_on:
      nats:
        condition: service_healthy
      postgres:
        condition: service_healthy

  grafana:
    image: grafana/grafana:11.1.3
    ports: ["3000:3000"]
"@
W "docker-compose.yml" $compose

# -------------------------------
# Makefile (Windows-friendly & resilient)
# -------------------------------
$make = @"
.PHONY: bootstrap dev test compose-up
SHELL:=/usr/bin/bash

bootstrap:
	@echo [bootstrap] Python venv + Poetry + deps
	@powershell -NoProfile -Command "if (!(Test-Path .venv)) { python -m venv .venv }"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; python -m pip install -U pip; pip install poetry"
	@echo [bootstrap] Service deps
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; cd apps\\services\\event-normalizer; poetry install"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; cd apps\\services\\tax-engine; poetry install"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; cd libs\\py-sdk; poetry install"
	@echo [bootstrap] Node/pnpm
	@powershell -NoProfile -Command "try { corepack enable; corepack prepare pnpm@latest --activate } catch { Write-Host 'corepack not available; skipping' }"
	@if exist apps\\web\\console (cd apps\\web\\console && pnpm install) else (echo no console yet)
	@echo [bootstrap]()
