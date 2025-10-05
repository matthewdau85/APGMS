# tools\fix_all.ps1
param(
  [string]$RepoRoot = (Resolve-Path ".").Path
)

$ErrorActionPreference = "Stop"
Write-Host "[ INFO ] Repo root: $RepoRoot"

function Backup-IfExists {
  param([string]$Path)
  if (Test-Path $Path) {
    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    Copy-Item $Path "$Path.$ts.bak" -Force
    Write-Host "[ OK ] Backed up: $Path -> $Path.$ts.bak"
  }
}

# ---------- Paths ----------
$taxDockerfile = Join-Path $RepoRoot "apps\services\tax-engine\Dockerfile"
$normDockerfile = Join-Path $RepoRoot "apps\services\event-normalizer\Dockerfile"
$normRun = Join-Path $RepoRoot "apps\services\event-normalizer\run_normalizer.py"
$normMain = Join-Path $RepoRoot "apps\services\event-normalizer\app\main.py"
$compose    = Join-Path $RepoRoot "docker-compose.yml"

# ---------- Fix tax-engine Dockerfile ----------
if (Test-Path $taxDockerfile) {
  Backup-IfExists $taxDockerfile
  @'
# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

# Poetry (pin pip + poetry)
RUN pip install --no-cache-dir pip==24.0 poetry==2.2.1
RUN poetry config virtualenvs.create false

# Copy only project metadata first
COPY pyproject.toml poetry.lock* ./

# Install dependencies only (not the project yet)
RUN poetry install --no-interaction --no-ansi --no-root

# Now copy source and install the current project
COPY . .
RUN poetry install --no-interaction --no-ansi
'@ | Set-Content -NoNewline -Encoding UTF8 $taxDockerfile
  Write-Host "[ OK ] Wrote fixed tax-engine Dockerfile"
} else {
  Write-Warning "[ WARN ] tax-engine Dockerfile not found at $taxDockerfile"
}

# ---------- Ensure normalizer launcher exists ----------
Backup-IfExists $normRun
@'
import os
import uvicorn

APP_MODULE = os.getenv("APP_MODULE", "app.main:app")
HOST = os.getenv("UVICORN_HOST", "0.0.0.0")
PORT = int(os.getenv("UVICORN_PORT", "8001"))
RELOAD = os.getenv("UVICORN_RELOAD", "false").lower() == "true"
LOG_LEVEL = os.getenv("UVICORN_LOG_LEVEL", "info")

if __name__ == "__main__":
    uvicorn.run(APP_MODULE, host=HOST, port=PORT, reload=RELOAD, log_level=LOG_LEVEL)
'@ | Set-Content -Encoding UTF8 $normRun
Write-Host "[ OK ] Ensured run_normalizer.py"

# ---------- Inject /healthz into normalizer if missing ----------
if (Test-Path $normMain) {
  $main = Get-Content $normMain -Raw
  # Use single-quoted regex to avoid PowerShell parsing the slash
  $needsHealth = ($main -notmatch '/healthz')
  if ($needsHealth) {
    Backup-IfExists $normMain
    @'
# --- BEGIN AUTO-ADDED HEALTH ENDPOINT ---
try:
    app  # expect FastAPI() instance defined earlier
except NameError:
    from fastapi import FastAPI
    app = FastAPI()

@app.get("/healthz")
def _healthz():
    return {"status": "ok"}
# --- END AUTO-ADDED HEALTH ENDPOINT ---
'@ | Add-Content -Encoding UTF8 $normMain
    Write-Host "[ OK ] Added /healthz to normalizer main.py"
  } else {
    Write-Host "[ OK ] /healthz already present in normalizer"
  }
} else {
  Write-Warning "[ WARN ] normalizer main.py not found at $normMain"
}

# ---------- Ensure APP_MODULE/UVICORN_PORT in docker-compose.yml ----------
if (Test-Path $compose) {
  Backup-IfExists $compose
  $lines = Get-Content $compose
  $out = New-Object System.Collections.Generic.List[string]
  $inNormalizer = $false
  $hadEnv = $false
  $hasAPP = $false
  $hasPORT = $false

  foreach ($line in $lines) {
    # Detect entering/exiting normalizer block (very simple heuristic)
    if ($line -match '^\s*normalizer:\s*$') {
      $inNormalizer = $true
      $hadEnv = $false
      $hasAPP = $false
      $hasPORT = $false
      $out.Add($line)
      continue
    }
    if ($inNormalizer -and $line -match '^\s*\w+:') {
      # Leaving normalizer block; inject environment if needed
      if (-not $hadEnv) {
        $out.Add('    environment:')
        $out.Add('      - APP_MODULE=app.main:app')
        $out.Add('      - UVICORN_PORT=8001')
      } else {
        if (-not $hasAPP)  { $out.Add('      - APP_MODULE=app.main:app') }
        if (-not $hasPORT) { $out.Add('      - UVICORN_PORT=8001') }
      }
      $inNormalizer = $false
    }

    if ($inNormalizer) {
      if ($line -match '^\s*environment:\s*$') { $hadEnv = $true }
      if ($line -match 'APP_MODULE=') { $hasAPP = $true }
      if ($line -match 'UVICORN_PORT=') { $hasPORT = $true }
    }

    $out.Add($line)
  }

  # If file ended while still in normalizer block, append env now
  if ($inNormalizer) {
    if (-not $hadEnv) {
      $out.Add('    environment:')
      $out.Add('      - APP_MODULE=app.main:app')
      $out.Add('      - UVICORN_PORT=8001')
    } else {
      if (-not $hasAPP)  { $out.Add('      - APP_MODULE=app.main:app') }
      if (-not $hasPORT) { $out.Add('      - UVICORN_PORT=8001') }
    }
  }

  $out | Set-Content -Encoding UTF8 $compose
  Write-Host "[ OK ] Ensured normalizer APP_MODULE/UVICORN_PORT in docker-compose.yml"
} else {
  Write-Warning "[ WARN ] docker-compose.yml not found at $compose"
}

# ---------- Rebuild the two services fresh ----------
Push-Location $RepoRoot
try {
  Write-Host "[ INFO ] Rebuilding images (no cache) for: tax-engine, normalizer"
  docker compose build --no-cache tax-engine normalizer

  Write-Host "[ INFO ] Starting stack"
  docker compose up -d

  function Wait-HttpOk {
    param(
      [string]$Url,
      [int]$TimeoutSec = 90,
      [int]$SleepMs = 1500
    )
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
      try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return $true }
      } catch { }
      Start-Sleep -Milliseconds $SleepMs
    }
    return $false
  }

  $normUrl = "http://127.0.0.1:8001/healthz"
  $taxUrl  = "http://127.0.0.1:8002/healthz"

  Write-Host "[ INFO ] Waiting for normalizer $normUrl"
  if (Wait-HttpOk -Url $normUrl) {
    Write-Host "[ OK ] Normalizer healthy"
  } else {
    Write-Warning "[ WARN ] Normalizer not healthy; recent logs:"
    docker compose logs --tail=120 normalizer
  }

  Write-Host "[ INFO ] Waiting for tax-engine $taxUrl"
  if (Wait-HttpOk -Url $taxUrl) {
    Write-Host "[ OK ] Tax-engine healthy"
  } else {
    Write-Warning "[ WARN ] Tax-engine not healthy; recent logs:"
    docker compose logs --tail=120 tax-engine
  }

} finally {
  Pop-Location
}
