# tools/full_repair.ps1
$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (!(Test-Path $path)) { return }
  $ts = Get-Date -Format "yyyyMMdd-HHmmss"
  $bak = "$path.$ts.bak"
  Copy-Item $path $bak -Force
  Write-Host "[ OK ] Backed up: $path -> $bak"
}

# Paths
$repo = Get-Location
$compose = Join-Path $repo "docker-compose.yml"
$normDir = Join-Path $repo "apps/services/event-normalizer"
$normApp = Join-Path $normDir "app"
$normMain = Join-Path $normApp "main.py"
$normRun  = Join-Path $normDir "run_normalizer.py"
$normDockerfile = Join-Path $normDir "Dockerfile"
$taxDir = Join-Path $repo "apps/services/tax-engine"
$taxDockerfile = Join-Path $taxDir "Dockerfile"

Write-Host "[ INFO ] Repo root: $repo"

# --- 1) Clean docker-compose.yml ---
Backup-File $compose

$composeBody = @'
version: "3.9"

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: apgms
      POSTGRES_PASSWORD: apgms
      POSTGRES_DB: apgms
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL","pg_isready -U apgms"]
      interval: 5s
      timeout: 5s
      retries: 20

  nats:
    image: nats:2.10-alpine
    command: ["-js", "-sd", "/data", "-m", "8222"]
    ports:
      - "4222:4222"
      - "8222:8222"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8222/healthz >/dev/null 2>&1 || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 20

  normalizer:
    build:
      context: .
      dockerfile: apps/services/event-normalizer/Dockerfile
    environment:
      APP_MODULE: "app.main:app"
      UVICORN_PORT: "8001"
      NATS_URL: "nats://nats:4222"
      SERVICE_PORT: "8001"
      PYTHONPATH: "/app"
    ports: ["8001:8001"]
    depends_on:
      nats:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8001/healthz >/dev/null 2>&1 || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 20
    restart: unless-stopped

  tax-engine:
    build:
      context: ./apps/services/tax-engine
      dockerfile: Dockerfile
    environment:
      NATS_URL: "nats://nats:4222"
      SERVICE_PORT: "8002"
    ports: ["8002:8002"]
    depends_on:
      nats:
        condition: service_healthy

  grafana:
    image: grafana/grafana:11.1.3
    ports: ["3000:3000"]
'@

Set-Content -Path $compose -Value $composeBody -Encoding UTF8
Write-Host "[ OK ] Wrote clean docker-compose.yml"

# --- 2) Ensure normalizer /healthz and launcher ---
if (!(Test-Path $normMain)) {
  throw "Expected normalizer main at $normMain but it does not exist."
}
Backup-File $normMain
$main = Get-Content $normMain -Raw -Encoding UTF8

if ($main -notmatch '\@app\.get\("/healthz"\)') {
  if ($main -notmatch '\bapp\s*=\s*FastAPI\s*\(') {
$prefix = @'
from fastapi import FastAPI
app = FastAPI()

'@
    $main = $prefix + $main
  }
$healthz = @'
@app.get("/healthz")
def healthz():
    return "ok"

'@
  $main = $main + $healthz
  Set-Content -Path $normMain -Value $main -Encoding UTF8
  Write-Host "[ OK ] Added /healthz to normalizer main.py"
} else {
  Write-Host "[ OK ] /healthz already present in normalizer main.py"
}

Backup-File $normRun
$runPy = @'
import os
import uvicorn

MODULE = os.getenv("APP_MODULE", "app.main:app")
HOST = os.getenv("UVICORN_HOST", "0.0.0.0")
PORT = int(os.getenv("UVICORN_PORT", "8001"))
RELOAD = os.getenv("UVICORN_RELOAD", "0") == "1"

if __name__ == "__main__":
    uvicorn.run(MODULE, host=HOST, port=PORT, reload=RELOAD)
'@
Set-Content -Path $normRun -Value $runPy -Encoding UTF8
Write-Host "[ OK ] Ensured run_normalizer.py"

# --- 3) Normalizer Dockerfile ---
Backup-File $normDockerfile
$normDocker = @'
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY apps/services/event-normalizer/app ./app
COPY libs/json ./libs/schemas/json
COPY apps/services/event-normalizer/run_normalizer.py /app/run_normalizer.py

RUN pip install --no-cache-dir \
      fastapi \
      "uvicorn[standard]" \
      pydantic

EXPOSE 8001
ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/run_normalizer.py"]
'@
Set-Content -Path $normDockerfile -Value $normDocker -Encoding UTF8
Write-Host "[ OK ] Wrote normalizer Dockerfile"

# --- 4) Tax-engine Dockerfile (Poetry, no-root first) ---
if (!(Test-Path $taxDir)) { throw "Missing $taxDir" }
Backup-File $taxDockerfile
$taxDocker = @'
FROM python:3.11-slim

ENV POETRY_VERSION=2.2.1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "poetry==${POETRY_VERSION}"

# Copy lock files first
COPY pyproject.toml poetry.lock* ./

# Install deps into system env (no venv) and skip installing the project
RUN poetry config virtualenvs.create false \
 && (poetry lock --no-update || true) \
 && poetry install --no-interaction --no-ansi --no-root

# Now copy the code
COPY . .

# If you need to install the project package itself, uncomment:
# RUN poetry install --no-interaction --no-ansi

EXPOSE 8002
# Adjust to your real entrypoint/module if different:
CMD ["python", "-m", "app"]
'@
Set-Content -Path $taxDockerfile -Value $taxDocker -Encoding UTF8
Write-Host "[ OK ] Wrote tax-engine Dockerfile"

# --- 5) Rebuild & start ---
Write-Host "[ INFO ] Rebuilding images (no cache) for: normalizer, tax-engine"
docker compose build --no-cache normalizer tax-engine | Out-Host

Write-Host "[ INFO ] Starting stack"
docker compose up -d | Out-Host

# --- 6) Health checks ---
function Wait-Healthy($name, $url, $seconds=60) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3
      if ($r.StatusCode -eq 200) {
        Write-Host "[ OK ] $name healthy => $url"
        return
      }
    } catch {}
    Start-Sleep -Seconds 2
  }
  Write-Warning "[ WARN ] $name not healthy after $seconds s => $url"
  Write-Warning ("Recent logs for {0}:" -f $name)
  try { docker compose logs --tail=200 $name | Out-Host } catch {}
}

Wait-Healthy "normalizer" "http://127.0.0.1:8001/healthz" 60
Wait-Healthy "tax-engine" "http://127.0.0.1:8002/healthz" 60
