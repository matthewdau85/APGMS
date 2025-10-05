<#
Repair-And-Test.ps1
- Scans, patches, builds, runs, and smoke-tests APGMS locally.
- Idempotent edits (BEGIN/END markers). Safe to re-run.
- Use -DownAfter to stop/clean containers after tests complete.
#>

[CmdletBinding()]
param(
  [string]$RepoRoot = (Get-Location).Path,
  [string]$ComposeFile = "docker-compose.yml",
  [string]$NormalizerMain = "apps/services/event-normalizer/app/main.py",
  [string]$TaxMain = "apps/services/tax-engine/app/main.py",
  [string]$ComposeProject = "apgms-final",
  [string]$NatsURL = "nats://nats:4222",
  [int]$ReadyTimeoutSec = 120,
  [switch]$DownAfter = $false
)

$ErrorActionPreference = "Stop"

function Write-Phase($t){ Write-Host "`n==== $t ====" -ForegroundColor Cyan }
function Write-Ok($t){ Write-Host "OK: $t" -ForegroundColor Green }
function Write-Info($t){ Write-Host "INFO: $t" -ForegroundColor Gray }
function Write-Warn($t){ Write-Host "WARN: $t" -ForegroundColor Yellow }
function Write-Err($t){ Write-Host "ERR: $t" -ForegroundColor Red }

function Assert-Tool {
  param([string]$Name, [string]$Hint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing tool '$Name'. $Hint"
  }
}

function Get-File($p){
  $fp = Join-Path $RepoRoot $p
  if (!(Test-Path $fp)) { return $null }
  $fp
}

function Detect-Network {
  param([string]$Project)
  # Try to find the compose default network
  $expected = "${Project}_default"
  $nets = (docker network ls --format "{{.Name}}") 2>$null
  if ($nets -and ($nets -contains $expected)) { return $expected }
  # Fall back to something that contains the project name
  $cand = $nets | Where-Object { $_ -like "*$Project*" } | Select-Object -First 1
  if ($cand) { return $cand }
  return $expected
}

function Ensure-Block {
  <#
    Ensures a BEGIN/END block exists (by tag) and replaces/creates it.
    -Tag: unique name in markers
    -Path: file path
    -Block: code to insert between markers (no markers included)
  #>
  param([string]$Tag,[string]$Path,[string]$Block)
  $begin = "# --- BEGIN $Tag ---"
  $end   = "# --- END $Tag ---"
  $txt = if (Test-Path $Path) { Get-Content -LiteralPath $Path -Raw } else { "" }
  if ($txt -match [regex]::Escape($begin)) {
    $pattern = [regex]::Escape($begin) + '(?s).*?' + [regex]::Escape($end)
    $rep = "$begin`r`n$Block`r`n$end"
    $new = [regex]::Replace($txt, $pattern, $rep)
  } else {
    if ($txt.Trim().Length -gt 0) {
      $new = $txt.TrimEnd() + "`r`n`r`n$begin`r`n$Block`r`n$end`r`n"
    } else {
      $new = "$begin`r`n$Block`r`n$end`r`n"
    }
  }
  if ($new -ne $txt) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path)
    Set-Content -LiteralPath $Path -Value $new -Encoding UTF8
    return $true
  }
  return $false
}

function Ensure-Normalizer {
  $path = Get-File $NormalizerMain
  if (-not $path) { Write-Warn "Normalizer main not found: $NormalizerMain (skipping patch)"; return $false }

  $tag = "NORMALIZER_CORE_APP"
  $code = @'
from __future__ import annotations

import asyncio
import os
from typing import Optional

import orjson
from fastapi import FastAPI, Response, status
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers

app = FastAPI(title="event-normalizer")

NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")
SUBJECT_TAX = os.getenv("SUBJECT_TAX", "apgms.tax.v1")

_nc: Optional[NATS] = None
_last_tax_result: dict = {}

_ready_event = asyncio.Event()
_started_event = asyncio.Event()

from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
    CONTENT_TYPE_LATEST,
    generate_latest,
)

NORMALIZER_TAX_RESULTS = Counter("normalizer_tax_results_total", "Total tax result messages received")
NORMALIZER_BYTES = Counter("normalizer_bytes_total", "Total bytes received on tax subject")
NORMALIZER_NATS_CONNECTED = Gauge("normalizer_nats_connected", "1 if connected to NATS, else 0")
NORMALIZER_ON_TAX_LATENCY = Histogram("normalizer_on_tax_seconds", "Callback time to process tax result")

@app.get("/metrics")
def metrics():
    data = generate_latest()
    return Response(content=data, media_type=CONTENT_TYPE_LATEST)

@app.get("/healthz")
def healthz():
    return {"ok": True, "started": _started_event.is_set()}

@app.get("/readyz")
def readyz():
    if _ready_event.is_set():
        return {"ready": True}
    return Response('{"ready": false}', media_type="application/json", status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

@app.get("/debug/last-tax")
def last_tax():
    return _last_tax_result

async def _connect_nats_with_retry() -> NATS:
    backoff = 0.5
    max_backoff = 8.0
    while True:
        try:
            nc = NATS()
            await nc.connect(servers=[NATS_URL])
            NORMALIZER_NATS_CONNECTED.set(1)
            return nc
        except ErrNoServers:
            NORMALIZER_NATS_CONNECTED.set(0)
        except Exception:
            NORMALIZER_NATS_CONNECTED.set(0)
        await asyncio.sleep(backoff)
        backoff = min(max_backoff, backoff * 2)

async def _subscribe_tax(nc: NATS):
    async def _on_tax(msg):
        with NORMALIZER_ON_TAX_LATENCY.time():
            global _last_tax_result
            data = msg.data or b""
            NORMALIZER_BYTES.inc(len(data))
            try:
                _last_tax_result = orjson.loads(data)
                NORMALIZER_TAX_RESULTS.inc()
            except Exception:
                pass
    await nc.subscribe(SUBJECT_TAX, cb=_on_tax)

@app.on_event("startup")
async def _startup():
    _started_event.set()
    async def runner():
        global _nc
        _nc = await _connect_nats_with_retry()
        await _subscribe_tax(_nc)
        _ready_event.set()
    asyncio.create_task(runner())

@app.on_event("shutdown")
async def _shutdown():
    global _nc
    if _nc and _nc.is_connected:
        try:
            await _nc.drain(timeout=2)
        except Exception:
            pass
        finally:
            try: await _nc.close()
            except Exception: pass
        NORMALIZER_NATS_CONNECTED.set(0)
'@
  $changed = Ensure-Block -Tag $tag -Path $path -Block $code
  if ($changed) { Write-Ok "Patched normalizer core app ($NormalizerMain)" } else { Write-Info "Normalizer already OK" }
  return $changed
}

function Ensure-TaxEngine {
  $path = Get-File $TaxMain
  if (-not $path) { Write-Warn "Tax-engine main not found: $TaxMain (skipping patch)"; return $false }

  $tag = "TAX_ENGINE_CORE_APP"
  $code = @'
from __future__ import annotations

import asyncio
import os
from typing import Optional

from fastapi import FastAPI, Response, status
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers

try:
    app  # reuse if exists
except NameError:
    app = FastAPI(title="tax-engine")

NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")
SUBJECT_INPUT = os.getenv("SUBJECT_INPUT", "apgms.normalized.v1")
SUBJECT_OUTPUT = os.getenv("SUBJECT_OUTPUT", "apgms.tax.v1")

_nc: Optional[NATS] = None
_started = asyncio.Event()
_ready = asyncio.Event()

TAX_REQS = Counter("tax_requests_total", "Total tax requests consumed")
TAX_OUT = Counter("tax_results_total", "Total tax results produced")
NATS_CONNECTED = Gauge("taxengine_nats_connected", "1 if connected to NATS else 0")
CALC_LAT = Histogram("taxengine_calc_seconds", "Calculate latency")

@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/healthz")
def healthz():
    return {"ok": True, "started": _started.is_set()}

@app.get("/readyz")
def readyz():
    if _ready.is_set():
        return {"ready": True}
    return Response('{"ready": false}', status_code=status.HTTP_503_SERVICE_UNAVAILABLE, media_type="application/json")

async def _connect_nats_with_retry() -> NATS:
    backoff, max_backoff = 0.5, 8.0
    while True:
        try:
            nc = NATS()
            await nc.connect(servers=[NATS_URL])
            NATS_CONNECTED.set(1)
            return nc
        except ErrNoServers:
            NATS_CONNECTED.set(0)
        except Exception:
            NATS_CONNECTED.set(0)
        await asyncio.sleep(backoff)
        backoff = min(max_backoff, backoff * 2)

async def _subscribe_and_run(nc: NATS):
    async def _on_msg(msg):
        with CALC_LAT.time():
            TAX_REQS.inc()
            data = msg.data or b"{}"
            # TODO: real calc -> publish real result
            await nc.publish(SUBJECT_OUTPUT, data)
            TAX_OUT.inc()
    await nc.subscribe(SUBJECT_INPUT, cb=_on_msg)
    _ready.set()

@app.on_event("startup")
async def startup():
    _started.set()
    async def runner():
        global _nc
        _nc = await _connect_nats_with_retry()
        await _subscribe_and_run(_nc)
    asyncio.create_task(runner())

@app.on_event("shutdown")
async def shutdown():
    global _nc
    if _nc and _nc.is_connected:
        try:
            await _nc.drain(timeout=2)
        except Exception:
            pass
        finally:
            try: await _nc.close()
            except Exception: pass
        NATS_CONNECTED.set(0)
'@
  $changed = Ensure-Block -Tag $tag -Path $path -Block $code
  if ($changed) { Write-Ok "Patched tax-engine core app ($TaxMain)" } else { Write-Info "Tax-engine already OK" }
  return $changed
}

function Ensure-Compose {
  $path = Get-File $ComposeFile
  if (-not $path) { throw "Compose file not found: $ComposeFile" }
  $txt = Get-Content -LiteralPath $path -Raw
  $orig = $txt

  # Normalizer: /readyz + start_period
  $txt = $txt -replace '(http://127\.0\.0\.1:8001/healthz)','http://127.0.0.1:8001/readyz'
  if ($txt -match 'normalizer:\s*(?:.|\n)*?healthcheck:' -and $txt -notmatch 'normalizer:\s*(?:.|\n)*?start_period:') {
    $txt = $txt -replace '(normalizer:\s*(?:.|\n)*?healthcheck:\s*(?:.|\n)*?retries:\s*\d+)',
      "`$1`n      start_period: 15s"
  }

  # Tax-engine: switch to /readyz if present in code
  $taxMainPath = Get-File $TaxMain
  $taxHasReady = $false
  if ($taxMainPath) {
    $taxHasReady = (Get-Content -LiteralPath $taxMainPath -Raw) -match '/readyz'
  }
  if ($taxHasReady) {
    $txt = $txt -replace '(http://127\.0\.0\.1:8002/healthz)','http://127.0.0.1:8002/readyz'
    if ($txt -match 'tax-engine:\s*(?:.|\n)*?healthcheck:' -and $txt -notmatch 'tax-engine:\s*(?:.|\n)*?start_period:') {
      $txt = $txt -replace '(tax-engine:\s*(?:.|\n)*?healthcheck:\s*(?:.|\n)*?retries:\s*\d+)',
        "`$1`n      start_period: 15s"
    }
  }

  if ($txt -ne $orig) {
    Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
    Write-Ok "Updated compose healthchecks (normalizer + tax-engine)"
    return $true
  } else {
    Write-Info "Compose healthchecks already aligned"
    return $false
  }
}

function Invoke-Http {
  param([string]$Url,[int]$TimeoutSec=2)
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec $TimeoutSec -Uri $Url
    return @{ ok = $true; code = $resp.StatusCode; body = $resp.Content }
  } catch {
    return @{ ok = $false; code = 0; body = "" }
  }
}

function Wait-Ready {
  param(
    [string]$Name,
    [string]$Url,
    [int]$TimeoutSec = $ReadyTimeoutSec,
    [string]$ServiceName
  )
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    $r = Invoke-Http -Url $Url -TimeoutSec 2
    if ($r.ok -and $r.code -eq 200) { Write-Ok "$Name ready ($Url)"; return $true }
    Start-Sleep -Seconds 2
  }
  Write-Err "$Name NOT ready within $TimeoutSec s ($Url)"
  if ($ServiceName) {
    Write-Info ("Last 120s of logs for {0}:" -f $ServiceName)
    docker compose logs --since=120s $ServiceName 2>$null | Out-String | Write-Host
    $hz = Invoke-Http -Url ($Url -replace '/readyz','/healthz') -TimeoutSec 2
    if ($hz.ok) { Write-Info ("{0} /healthz: {1}" -f $ServiceName, $hz.body) }
  }
  return $false
}

function Run-Nats {
  param([string]$Network,[string]$Subject,[string]$Json,[string]$Server)
  # Use synadia/natscli which has 'nats' as the entrypoint
  $args = @('run','--rm','--network', $Network, 'synadia/natscli:latest','pub', $Subject, $Json, '--server', $Server)
  Write-Info "docker $($args -join ' ')"
  $p = Start-Process -FilePath "docker" -ArgumentList $args -NoNewWindow -Wait -PassThru
  return $p.ExitCode -eq 0
}

# ====================== PHASES ======================

Write-Phase "Phase 0: Prerequisites"
Assert-Tool docker "Install Docker Desktop and ensure 'docker' is on PATH."
Assert-Tool curl.exe "Windows curl.exe should be available."
Write-Ok "Tools present"

# Figure out the compose network once so NATS publishes work even on renamed networks
$ComposeNetwork = Detect-Network -Project $ComposeProject
Write-Info "Using network: $ComposeNetwork"

Write-Phase "Phase 1: Patch normalizer"
$normPatched = Ensure-Normalizer

Write-Phase "Phase 2: Patch tax-engine"
$taxPatched = Ensure-TaxEngine

Write-Phase "Phase 3: Align docker-compose healthchecks"
$composePatched = Ensure-Compose

Write-Phase "Phase 4: Build & Run"
Push-Location $RepoRoot
try {
  docker compose up -d --build | Out-Null
  Write-Ok "Compose up"
} finally { Pop-Location }

Write-Phase "Phase 5: Wait for readiness"
$okNats = Wait-Ready -Name "NATS" -Url "http://127.0.0.1:8222/healthz" -ServiceName "nats"
$okNorm = Wait-Ready -Name "Normalizer (readyz)" -Url "http://127.0.0.1:8001/readyz" -ServiceName "normalizer"
$okTax  = Wait-Ready -Name "Tax-Engine (readyz)" -Url "http://127.0.0.1:8002/readyz" -ServiceName "tax-engine"

Write-Phase "Phase 6: NATS smoke"
$pub1 = Run-Nats -Network $ComposeNetwork -Subject "apgms.tax.v1" -Json '{"calc":"ok","amount":123.45}' -Server $NatsURL
if ($pub1) {
  $last = Invoke-Http -Url "http://127.0.0.1:8001/debug/last-tax" -TimeoutSec 3
  if ($last.ok -and $last.body -and $last.body -ne "{}") {
    Write-Ok "Normalizer received tax result: $($last.body)"
  } else {
    Write-Warn "Publish OK but /debug/last-tax empty; ensure normalizer subscription is active"
  }
} else {
  Write-Err "Failed to publish to apgms.tax.v1"
}

# Optional end-to-end: only if tax-engine subscribes to apgms.normalized.v1
$pub2 = Run-Nats -Network $ComposeNetwork -Subject "apgms.normalized.v1" -Json '{"id":"demo-001","entity":"AUS-PTY","period":"2025-09","gross":1000.0,"taxable":1000.0}' -Server $NatsURL
if ($pub2) { Write-Ok "Published normalized event (check tax-engine counters)" } else { Write-Warn "Could not publish normalized event" }

Write-Phase "Phase 7: Metrics checks"
$normMetrics = Invoke-Http -Url "http://127.0.0.1:8001/metrics" -TimeoutSec 3
if ($normMetrics.ok) {
  if ($normMetrics.body -match 'normalizer_tax_results_total\s+(\d+\.?\d*)') {
    Write-Ok "normalizer_tax_results_total=$($matches[1])"
  } else { Write-Warn "Could not parse normalizer_tax_results_total" }
} else { Write-Err "Normalizer metrics unavailable" }

$taxMetrics = Invoke-Http -Url "http://127.0.0.1:8002/metrics" -TimeoutSec 3
if ($taxMetrics.ok) {
  if ($taxMetrics.body -match 'tax_requests_total\s+(\d+\.?\d*)') { Write-Ok "tax_requests_total=$($matches[1])" }
  if ($taxMetrics.body -match 'tax_results_total\s+(\d+\.?\d*)') { Write-Ok "tax_results_total=$($matches[1])" }
} else { Write-Warn "Tax-engine metrics unavailable (OK if app not instrumented yet)" }

Write-Phase "Summary"
"{0,-12} {1}" -f "Patched:", ("normalizer=$normPatched; tax=$taxPatched; compose=$composePatched")
"{0,-12} {1}" -f "Ready:", ("nats=$okNats; normalizer=$okNorm; tax=$okTax")
Write-Ok "Done."

if ($DownAfter) {
  Write-Host "`nStopping containers..." -ForegroundColor Yellow
  Push-Location $RepoRoot
  try { docker compose down --remove-orphans -v | Out-Null } finally { Pop-Location }
  Write-Host "Stack stopped and cleaned." -ForegroundColor Green
}
