param(
  [string]$RepoRoot = (Resolve-Path ".").Path
)

$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (Test-Path $path) {
    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $bak = "$path.$ts.bak"
    Copy-Item $path $bak -Force
    Write-Host "[ OK ] Backed up: $path -> $bak"
  }
}

function Ensure-Directory($p) {
  $d = Split-Path -Parent $p
  if ($d -and !(Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}

Write-Host "[ INFO ] Repo root: $RepoRoot"

# --- Paths ---
$composePath = Join-Path $RepoRoot "docker-compose.yml"
$normMain    = Join-Path $RepoRoot "apps/services/event-normalizer/app/main.py"
$normRunner  = Join-Path $RepoRoot "apps/services/event-normalizer/run_normalizer.py"
$normDock    = Join-Path $RepoRoot "apps/services/event-normalizer/Dockerfile"
$taxDock     = Join-Path $RepoRoot "apps/services/tax-engine/Dockerfile"

# --- 1) Fix docker-compose.yml (normalize 'normalizer' environment) ---
if (!(Test-Path $composePath)) { throw "docker-compose.yml not found at $composePath" }
Backup-File $composePath

$compose = Get-Content $composePath -Raw -Encoding UTF8

# Find 'normalizer:' block
$normHdr = [regex]::Match($compose, '^[ \t]*normalizer:\s*(?:\r?\n)+', 'Multiline')
if (!$normHdr.Success) { throw "Could not find 'normalizer:' service in docker-compose.yml" }

$afterHdr = $compose.Substring($normHdr.Index + $normHdr.Length)
$nextService = [regex]::Match($afterHdr, '^[ \t]*[A-Za-z0-9._-]+:\s*(?:\r?\n)+', 'Multiline')
$blockLen = if ($nextService.Success) { $nextService.Index } else { $afterHdr.Length }
$normBlock = $afterHdr.Substring(0, $blockLen)

# Gather existing env entries (both list '- K=V' and map 'K: V')
$env = @{}

# list style
$listMatches = [regex]::Matches($normBlock, '^\s*-\s*([A-Za-z0-9_]+)=(.*)\s*$', 'Multiline')
foreach ($m in $listMatches) { $env[$m.Groups[1].Value] = $m.Groups[2].Value }

# mapped style under environment:
$mapSection = [regex]::Match($normBlock, '^\s*environment:\s*(?:\r?\n)((?:\s{6,}[A-Za-z0-9_]+\s*:\s*.*(?:\r?\n|$))*)', 'Multiline')
if ($mapSection.Success) {
  $mapLines = ($mapSection.Groups[1].Value -split "(\r?\n)") | Where-Object { $_ -and $_ -notmatch '^\s*$' }
  foreach ($L in $mapLines) {
    if ($L -match '^\s*([A-Za-z0-9_]+)\s*:\s*(.*)\s*$') {
      $k = $matches[1]; $v = $matches[2]
      if ($v -match '^"(.*)"$') { $v = $matches[1] }
      $env[$k] = $v
    }
  }
}

# Enforce required variables
$env["APP_MODULE"]   = "app.main:app"
$env["UVICORN_PORT"] = "8001"

# Build a clean environment mapping
# Determine base indent based on the 'normalizer:' line
$baseIndent = ([regex]::Match($compose.Substring(0, $normHdr.Index + 1), '([ \t]*)normalizer:\s*$', 'Multiline')).Groups[1].Value
$envKeyIndent = "${baseIndent}  "
$envValIndent = "${baseIndent}    "

# Remove ALL existing environment blocks (list or map) and stray list items at env level
$normBlockClean = $normBlock `
  -replace '(?ms)^\s*environment:\s*(?:\r?\n(?:\s*-\s*[A-Za-z0-9_]+=.*\s*\r?\n?)*)', '' `
  -replace '(?ms)^\s*environment:\s*(?:\r?\n(?:\s{6,}[A-Za-z0-9_]+\s*:.*\r?\n?)*)', '' `
  -replace '(?m)^\s*-\s*[A-Za-z0-9_]+=.*\s*$', ''

# Compose new mapping
$envYaml = "${envKeyIndent}environment:`r`n"
foreach ($k in ($env.Keys | Sort-Object)) {
  $v = $env[$k]
  if ($v -match '[:#\s]') { $v = '"' + ($v -replace '"','\"') + '"' }
  $envYaml += "${envValIndent}${k}: ${v}`r`n"
}

# Reassemble file with env mapping at the top of the normalizer block
$before = $compose.Substring(0, $normHdr.Index + $normHdr.Length)
$after  = $afterHdr.Substring($blockLen)
$normBlockFixed = $envYaml + $normBlockClean
$composeFixed = $before + $normBlockFixed + $after

$composeFixed | Set-Content -Encoding UTF8 $composePath
Write-Host "[ OK ] docker-compose.yml normalized for 'normalizer' (single environment mapping)."

# --- 2) Normalizer FastAPI app & /healthz ---
if (!(Test-Path $normMain)) { throw "Expected normalizer main at $normMain" }
Backup-File $normMain
$main = Get-Content $normMain -Raw -Encoding UTF8

# Ensure 'app = FastAPI(...)' exists
if ($main -notmatch '^\s*app\s*=\s*FastAPI\(') {
$main = @"
from fastapi import FastAPI
import os

app = FastAPI()
"@ + "`r`n" + $main
}

# Ensure /healthz route
if ($main -notmatch '@app\.get\("/healthz"\)') {
$main += @"

@app.get("/healthz")
def healthz():
    return "ok"
"@
  Write-Host "[ OK ] Injected /healthz into normalizer main.py"
} else {
  Write-Host "[ OK ] /healthz already present in normalizer main.py"
}

$main | Set-Content -Encoding UTF8 $normMain

# Ensure run_normalizer.py
Ensure-Directory $normRunner
if (Test-Path $normRunner) { Backup-File $normRunner }
$runner = @"
import os, uvicorn

module  = os.getenv("APP_MODULE", "app.main:app")
host    = os.getenv("UVICORN_HOST", "0.0.0.0")
port    = int(os.getenv("UVICORN_PORT", "8001"))
workers = int(os.getenv("UVICORN_WORKERS", "1"))

if __name__ == "__main__":
    uvicorn.run(module, host=host, port=port, workers=workers)
"@
$runner | Set-Content -Encoding UTF8 $normRunner
Write-Host "[ OK ] Ensured run_normalizer.py"

# --- 3) Dockerfiles ---
# 3a) Normalizer Dockerfile (pip)
Backup-File $normDock
$normDockerfile = @"
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir fastapi "uvicorn[standard]" pydantic

COPY app ./app
COPY ../../libs/json ./libs/schemas/json
COPY run_normalizer.py /app/run_normalizer.py

ENV APP_MODULE=app.main:app UVICORN_PORT=8001
EXPOSE 8001
CMD ["python", "/app/run_normalizer.py"]
"@
$normDockerfile | Set-Content -Encoding UTF8 $normDock
Write-Host "[ OK ] Wrote normalizer Dockerfile"

# 3b) Tax-engine Dockerfile (Poetry --no-root)
Backup-File $taxDock
$taxDockerfile = @"
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml poetry.lock* ./
RUN pip install --no-cache-dir poetry \
 && poetry config virtualenvs.create false \
 && (poetry lock || true) \
 && poetry install --no-interaction --no-ansi --no-root

COPY app ./app

ENV APP_MODULE=app.main:app UVICORN_PORT=8002
EXPOSE 8002
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
"@
$taxDockerfile | Set-Content -Encoding UTF8 $taxDock
Write-Host "[ OK ] Wrote tax-engine Dockerfile"

# --- 4) Rebuild & start ---
Write-Host "[ INFO ] Rebuilding images (no cache) for: tax-engine, normalizer"
docker compose build --no-cache tax-engine normalizer | Write-Host

Write-Host "[ INFO ] Starting stack"
docker compose up -d | Write-Host

Start-Sleep -Seconds 3

# --- 5) Health checks ---
function Wait-Healthy($name, $url, $timeoutSec=60) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
    try {
      $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
        Write-Host "[ OK ] $name healthy => $url"
        return $true
      }
    } catch { Start-Sleep -Milliseconds 800 }
  }
  Write-Warning "[ WARN ] $name not healthy after $timeoutSec s => $url"
  try {
    Write-Warning ("Recent logs for ${name}:")
    docker compose logs --tail=200 $name | Write-Host
  } catch {}
  return $false
}

$normOk = Wait-Healthy "normalizer" "http://127.0.0.1:8001/healthz"
$taxOk  = Wait-Healthy "tax-engine" "http://127.0.0.1:8002/healthz"

if (-not $normOk -or -not $taxOk) {
  Write-Warning "One or more services are unhealthy. See logs above."
  exit 1
}

Write-Host "`n[ DONE ] All fixes applied and both services are healthy."
