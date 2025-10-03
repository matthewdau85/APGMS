# tools\phase3_fix.ps1
[CmdletBinding()]
param([switch]$FollowLogs)
$ErrorActionPreference = 'Stop'

function Log  ($m){Write-Host "[INFO] $m" -ForegroundColor Cyan}
function Ok   ($m){Write-Host "[ OK ] $m" -ForegroundColor Green}
function Warn ($m){Write-Host "[WARN] $m" -ForegroundColor Yellow}
function Fail ($m){Write-Error "Fail : $m"}

function Test-HttpOk {
  param([string]$Url,[int]$TimeoutSeconds=30,[int]$RetryDelayMs=500)
  $deadline=(Get-Date).AddSeconds($TimeoutSeconds)
  while((Get-Date) -lt $deadline){
    try{
      $r=Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      if($r.StatusCode -ge 200 -and $r.StatusCode -lt 300){return $true}
    }catch{}
    Start-Sleep -Milliseconds $RetryDelayMs
  }
  $false
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot
Ok "Repo: $RepoRoot"

# --- paths
$NormDir        = Join-Path $RepoRoot 'apps\services\event-normalizer'
$NormAppDir     = Join-Path $NormDir 'app'
$NormDocker     = Join-Path $NormDir 'Dockerfile'
$JsonSchemasDir = Join-Path $RepoRoot 'libs\json'
$TaxDir         = Join-Path $RepoRoot 'apps\services\tax-engine'
$TaxDocker      = Join-Path $TaxDir 'Dockerfile'

if(!(Test-Path $NormAppDir)){ Fail "Expected $NormAppDir"; exit 1 }
if(!(Test-Path $JsonSchemasDir)){ Fail "Expected $JsonSchemasDir"; exit 1 }

# Ensure PHASE3 flag mention exists (safe noop if already there)
$MainPy = Get-ChildItem -Path $NormAppDir -Recurse -Filter main.py | Select-Object -First 1
if($MainPy){
  $txt = Get-Content -Raw $MainPy.FullName
  if($txt -notmatch 'PHASE3_NORMALIZER_DEBUG_TAX'){
    Log "Injecting PHASE3 flag scaffold in $($MainPy.FullName)"
    $inject = @'
import os as _phase3_os
_PHASE3_DEBUG = _phase3_os.getenv("PHASE3_NORMALIZER_DEBUG_TAX")
'@
    Set-Content -LiteralPath $MainPy.FullName -Value ($inject + "`r`n" + $txt) -Encoding UTF8
    Ok "Inserted PHASE3 scaffold"
  } else { Ok "PHASE3_NORMALIZER_DEBUG_TAX already present in main.py (skipping)" }
}

# NEW: write a tiny launcher that auto-discovers the FastAPI app for the normalizer
$NormRunner = Join-Path $NormDir 'run_normalizer.py'
$runnerSrc = @'
import importlib, os, sys, time
import uvicorn

PORT = int(os.getenv("PORT", "8001"))
CANDIDATES = [
  "app.main:app",
  "app.api:app",
  "app.app:app",
  "main:app",
  "api:app",
]

# Allow override
if os.getenv("APP_MODULE"):
  CANDIDATES.insert(0, os.environ["APP_MODULE"])

def load_app(spec):
  mod, _, attr = spec.partition(":")
  m = importlib.import_module(mod)
  a = getattr(m, attr or "app")
  return a

last_err = None
for spec in CANDIDATES:
  try:
    application = load_app(spec)
    print(f"[launcher] Using application at {spec}", flush=True)
    uvicorn.run(application, host="0.0.0.0", port=PORT)
    sys.exit(0)
  except Exception as e:
    last_err = e

print("[launcher] Failed to locate FastAPI app. Last error:", last_err, file=sys.stderr, flush=True)
time.sleep(1)
sys.exit(1)
'@
Set-Content -LiteralPath $NormRunner -Value $runnerSrc -Encoding UTF8
Ok "Wrote run_normalizer.py (auto-discovers FastAPI app)"

# Write pip-only Dockerfile for normalizer using the launcher
Log "Writing pip-based Dockerfile for normalizer (repo-root COPY paths)"
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
if(Test-Path $NormDocker){ Copy-Item $NormDocker "$NormDocker.$ts.bak"; Ok "Backed up: $NormDocker -> $NormDocker.$ts.bak" }

$normDockerPip = @'
FROM python:3.11-slim
WORKDIR /app

# Source
COPY apps/services/event-normalizer/app ./app
COPY apps/services/event-normalizer/run_normalizer.py ./run_normalizer.py
COPY libs/json ./libs/schemas/json

# Deps
RUN pip install --no-cache-dir \
    fastapi \
    "uvicorn[standard]" \
    pydantic \
    nats-py \
    orjson \
    prometheus-client

EXPOSE 8001
ENV PORT=8001
CMD ["python","-u","run_normalizer.py"]
'@
Set-Content -LiteralPath $NormDocker -Value $normDockerPip -Encoding UTF8
Ok "Dockerfile updated for normalizer (pip-only + launcher)"

# NEW: patch tax-engine Dockerfile to run `poetry lock` before install (fixes stale lock)
if(Test-Path $TaxDocker){
  Log "Patching tax-engine Dockerfile to regenerate lock before install"
  $orig = Get-Content -Raw $TaxDocker
  if($orig -notmatch 'poetry lock'){
    $patched = $orig -replace '(RUN\s+pip\s+install[^\n]+poetry[^\n]*)(\s*&&\s*poetry\s+config[^\n]+)(\s*&&\s*poetry\s+install[^\n]+)',
      '$1 && poetry lock --no-update $2 $3'
    Set-Content -LiteralPath $TaxDocker -Value $patched -Encoding UTF8
    Ok "Tax-engine Dockerfile patched (added: poetry lock --no-update)"
  } else {
    Ok "Tax-engine Dockerfile already regenerates lock (skipping)"
  }
} else {
  Warn "Tax-engine Dockerfile not found at $TaxDocker (skipping patch)"
}

# Rebuild and start
Log "Rebuilding images (no cache): normalizer, tax-engine"
try { docker compose build --no-cache normalizer tax-engine | Write-Host } catch { Warn "Build failed; attempting to start existing images..." }

Log "Starting services: normalizer, tax-engine"
docker compose up -d normalizer tax-engine | Write-Host

if($FollowLogs){
  Start-Job -Name 'follow-logs' -ScriptBlock { docker compose logs -f normalizer tax-engine } | Out-Null
}

# Health
Log "Checking health..."
$normUrl  = "http://127.0.0.1:8001/healthz"
$taxUrl   = "http://127.0.0.1:8002/healthz"
$debugUrl = "http://127.0.0.1:8001/debug/last-tax"

if(Test-HttpOk -Url $normUrl -TimeoutSeconds 60){ Ok "Normalizer healthy ($normUrl)" } else { Warn "Normalizer not healthy after 60s ($normUrl)" }
if(Test-HttpOk -Url $taxUrl  -TimeoutSeconds 60){ Ok "Tax-engine healthy ($taxUrl)" } else { Warn "Tax-engine not healthy after 60s ($taxUrl)" }

try {
  $resp = Invoke-WebRequest -UseBasicParsing -Uri $debugUrl -TimeoutSec 5
  if($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300){ Ok "/debug/last-tax endpoint present" }
  else { Warn "Unexpected status from /debug/last-tax: $($resp.StatusCode)" }
} catch { Warn "Unable to reach /debug/last-tax (this should be 200 even if empty). Continuing" }

# Run Phase 3 test if present
$phase3Test = Join-Path $RepoRoot 'tests\Phase3.Tests.ps1'
if(Test-Path $phase3Test){
  Log "Running Phase 3 test..."
  Log "Ensuring docker services are up"
  docker compose up -d postgres nats normalizer tax-engine | Write-Host

  Log "Waiting for NATS /healthz"
  if(!(Test-HttpOk -Url "http://127.0.0.1:8222/healthz" -TimeoutSeconds 60)){ Fail "NATS not healthy"; exit 1 } else { Ok "NATS healthy" }

  Log "Waiting for normalizer /healthz"
  if(!(Test-HttpOk -Url $normUrl -TimeoutSeconds 60)){ Fail "Normalizer not healthy"; exit 1 } else { Ok "Normalizer healthy" }

  Log "Waiting for tax-engine /healthz"
  if(!(Test-HttpOk -Url $taxUrl -TimeoutSeconds 60)){ Fail "Tax-engine not healthy"; exit 1 } else { Ok "Tax-engine healthy" }

  Log "Waiting for tax-engine /metrics"
  if(!(Test-HttpOk -Url "http://127.0.0.1:8002/metrics" -TimeoutSeconds 60)){ Fail "/metrics not reachable"; exit 1 } else { Ok "/metrics reachable" }

  & $phase3Test
} else {
  Warn "Phase 3 test not found at $phase3Test - skipping test run."
}

if($FollowLogs){
  Log 'Logs are following in a background job named ''follow-logs''. Run: Stop-Job -Name follow-logs to end.'
}
