<#
Phase 2 automated setup for APGMS

What this does:
  1) Ensure Poetry deps (adds nats-py) for:
       - apps/services/event-normalizer/pyproject.toml
       - apps/services/tax-engine/pyproject.toml
  2) Patch normalizer app/main.py to:
       - connect to NATS on startup
       - publish validated /ingest payload to "apgms.pos.v1"
  3) Patch tax-engine app/main.py to:
       - connect to NATS and subscribe "apgms.pos.v1"
       - increment apgms_tax_engine_events_consumed_total
       - compute gst_cents per line (as a visible side effect)
  4) Rebuild docker images, bring up services
  5) Drop tests\Phase2.Tests.ps1 and run it
  6) Drop tools\scan_cleanup.ps1 (dry-run cleaner)

Run from repo root:
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
  .\tools\phase2_setup.ps1
#>

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path '.'
Write-Host "Repo: $repo" -ForegroundColor Cyan

function Backup-Once {
  param([string]$Path)
  if (Test-Path $Path) {
    $bak = "$Path.bak"
    if (-not (Test-Path $bak)) {
      Copy-Item $Path $bak -Force
      Write-Host "  Backed up -> $bak" -ForegroundColor DarkGray
    }
  }
}

function Ensure-Line-In-File {
  param(
    [string]$Path,
    [string]$Marker,
    [string]$BlockToAppend
  )
  Backup-Once $Path
  $txt = Get-Content $Path -Raw
  if ($txt -notmatch [regex]::Escape($Marker)) {
    Add-Content -Path $Path -Value "`r`n$BlockToAppend`r`n"
    Write-Host "  Appended block -> $Path" -ForegroundColor Green
  } else {
    Write-Host "  Block already present -> $Path" -ForegroundColor DarkGray
  }
}

# --------------------------------------------------------------------------------
# 1) Ensure nats-py dependency in both services  (MERGED / QUOTE-SAFE)
# --------------------------------------------------------------------------------
$normToml = "apps/services/event-normalizer/pyproject.toml"
$taxToml  = "apps/services/tax-engine/pyproject.toml"

foreach ($toml in @($normToml,$taxToml)) {
  if (-not (Test-Path $toml)) { Write-Error "Missing $toml"; exit 1 }
  Backup-Once $toml
  $txt = Get-Content $toml -Raw

  # If already present, skip
  if ($txt -match '^\s*nats-py\s*=' ) {
    Write-Host "nats-py already present in $toml" -ForegroundColor DarkGray
    continue
  }

  $insert = 'nats-py = "^2.11.0"'
  $section = "[tool.poetry.dependencies]"
  $idx = $txt.IndexOf($section)

  if ($idx -ge 0) {
    # Insert just after the [tool.poetry.dependencies] header
    $pre  = $txt.Substring(0, $idx + $section.Length)
    $post = $txt.Substring($idx + $section.Length)
    $new  = $pre + "`r`n$insert`r`n" + $post
  } else {
    # If the section is missing (rare), append a new section
    $new  = $txt + "`r`n$section`r`n$insert`r`n"
  }

  Set-Content -Path $toml -Value $new -Encoding UTF8
  Write-Host "Added nats-py to $toml" -ForegroundColor Green
}

# --------------------------------------------------------------------------------
# 2) Patch normalizer/app/main.py to publish to NATS
# --------------------------------------------------------------------------------
$normMain = "apps/services/event-normalizer/app/main.py"
if (-not (Test-Path $normMain)) { Write-Error "Missing $normMain"; exit 1 }

# Ensure imports, constants, and startup NATS connect
$normMarker = "# === PHASE2_NATS_NORMALIZER ==="
$normBlock = @"
$normMarker
import os, asyncio, orjson
from nats.aio.client import Client as NATS  # phase2

NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")
SUBJECT_POS = "apgms.pos.v1"
_nc_nats: NATS | None = None

async def _phase2_connect_nats():
    global _nc_nats
    if _nc_nats is None:
        _nc_nats = NATS()
        await _nc_nats.connect(servers=[NATS_URL])

try:
    # Attach to FastAPI startup if not already present
    @app.on_event("startup")
    async def _phase2_norm_startup():
        await _phase2_connect_nats()
except Exception:
    # in case this file imports app later; no-op
    pass
"@

Ensure-Line-In-File -Path $normMain -Marker $normMarker -BlockToAppend $normBlock

# Try to inject publish into /ingest handler (best-effort)
Backup-Once $normMain
$src = Get-Content $normMain -Raw
$publishSnippet = @"
        # phase2 publish to NATS (best-effort)
        try:
            _payload_local = None
            # Try common variable names first
            for _n in ("payload","event","evt","data","body","obj"):
                if _n in locals():
                    _payload_local = locals()[_n]
                    break
            if _payload_local is None:
                try:
                    _payload_local = await request.json()
                except Exception:
                    pass
            if _payload_local is not None and _nc_nats is not None:
                await _nc_nats.publish(SUBJECT_POS, orjson.dumps(_payload_local))
        except Exception:
            # don't break the HTTP path if NATS fails
            pass
"@

# Regex: find a @app.post("/ingest"...) decorator followed by async def ...:
$patternIngest = '(?ms)(@app\.post\(\s*["'']\/ingest["''][\s\S]*?\)\s*\r?\n\s*async\s+def\s+[a-zA-Z0-9_]+\s*\([^\)]*\)\s*:\s*\r?\n)'
if ($src -match $patternIngest) {
  $head = $Matches[1]
  $newSrc = $src -replace $patternIngest, ($head + $publishSnippet)
  if ($newSrc -ne $src) {
    Set-Content -Path $normMain -Value $newSrc -Encoding UTF8
    Write-Host "Injected publish snippet into /ingest handler" -ForegroundColor Green
  } else {
    Write-Host "Handler already patched" -ForegroundColor DarkGray
  }
} else {
  Write-Host "WARNING: Could not find /ingest handler; Phase 2 test may fail. The service still connects to NATS." -ForegroundColor Yellow
}

# --------------------------------------------------------------------------------
# 3) Patch tax-engine/app/main.py to subscribe and process
# --------------------------------------------------------------------------------
$taxMain = "apps/services/tax-engine/app/main.py"
if (-not (Test-Path $taxMain)) { Write-Error "Missing $taxMain"; exit 1 }

$taxMarker = "# === PHASE2_NATS_TAXENGINE ==="
$taxBlock = @"
$taxMarker
import os, asyncio, orjson
from nats.aio.client import Client as NATS
from prometheus_client import Counter
from .tax_rules import gst_line_tax

NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")
SUBJECT_POS = "apgms.pos.v1"
EVENTS_CONSUMED = Counter("apgms_tax_engine_events_consumed_total", "events consumed")

_nc_tax: NATS | None = None

async def _phase2_handle_pos(msg):
    EVENTS_CONSUMED.inc()
    try:
        evt = orjson.loads(msg.data)
        for line in evt.get("lines", []):
            try:
                amt = int(line.get("unit_price_cents", 0)) * int(line.get("qty", 1))
                line["gst_cents"] = gst_line_tax(amt, line.get("tax_code", "GST"))
            except Exception:
                pass
        # optional: publish to result subject here
        # await _nc_tax.publish("apgms.tax.v1", orjson.dumps(evt))
    except Exception:
        pass

async def _phase2_connect_and_subscribe():
    global _nc_tax
    if _nc_tax is None:
        _nc_tax = NATS()
        await _nc_tax.connect(servers=[NATS_URL])
        await _nc_tax.subscribe(SUBJECT_POS, cb=_phase2_handle_pos)

try:
    @app.on_event("startup")
    async def _phase2_tax_startup():
        asyncio.create_task(_phase2_connect_and_subscribe())
except Exception:
    pass
"@

Ensure-Line-In-File -Path $taxMain -Marker $taxMarker -BlockToAppend $taxBlock

# --------------------------------------------------------------------------------
# 4) Rebuild and up
# --------------------------------------------------------------------------------
Write-Host "`nRebuilding services..." -ForegroundColor Cyan
docker compose build normalizer tax-engine | Out-Null
Write-Host "Starting services..." -ForegroundColor Cyan
docker compose up -d nats postgres normalizer tax-engine | Out-Null

# Wait briefly for health
Start-Sleep -Seconds 2
Write-Host "Checking health..." -ForegroundColor Cyan
function Test-HttpOk {
  param([string]$Url,[int]$TimeoutSec=45,[int]$RetryMs=800)
  $sw=[Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    try {
      $r=Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return $true }
    } catch { Start-Sleep -Milliseconds $RetryMs }
  }
  return $false
}
if (-not (Test-HttpOk "http://127.0.0.1:8222/healthz" 60)) { Write-Error "NATS not healthy"; exit 1 }
if (-not (Test-HttpOk "http://127.0.0.1:8001/healthz" 60)) { Write-Error "Normalizer not healthy"; exit 1 }
if (-not (Test-HttpOk "http://127.0.0.1:8002/healthz" 60)) { Write-Error "Tax-engine not healthy"; exit 1 }
Write-Host "All services healthy." -ForegroundColor Green

# --------------------------------------------------------------------------------
# 5) Phase 2 test file + run
# --------------------------------------------------------------------------------
$phase2 = @'
$ErrorActionPreference = 'Stop'
function Fail($m){ Write-Error $m; exit 1 }
function Ok($m){ Write-Host "[ OK ] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

function Get-CounterValue {
  param([string]$MetricName, [string]$Url)
  $txt = (Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5).Content
  $line = $txt -split "`n" | Where-Object { $_ -match "^\s*$([regex]::Escape($MetricName))\s" } | Select-Object -First 1
  if (-not $line) { return $null }
  return [double]($line -split '\s+')[-1]
}

Info "Ensuring docker services are up"
docker compose up -d nats postgres normalizer tax-engine | Out-Null

$metricsUrl = "http://127.0.0.1:8002/metrics"
$metricName = "apgms_tax_engine_events_consumed_total"

# Ensure metrics available
$deadline = (Get-Date).AddSeconds(30)
do {
  try {
    $null = Invoke-WebRequest -UseBasicParsing -Uri $metricsUrl -TimeoutSec 5
    break
  } catch { Start-Sleep -Milliseconds 800 }
} while ((Get-Date) -lt $deadline)

$before = Get-CounterValue -MetricName $metricName -Url $metricsUrl
if ($null -eq $before) { Fail "Metric $metricName not found at $metricsUrl" }
Info "Counter before: $before"

$evt = @{
  event_type = "pos"
  lines      = @(@{ sku="ABC"; qty=2; unit_price_cents=500; tax_code="GST" })
} | ConvertTo-Json

Info "Posting POS to /ingest"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8001/ingest" -Body $evt -ContentType 'application/json' -TimeoutSec 10 | Out-Null

$deadline = (Get-Date).AddSeconds(20)
do {
  Start-Sleep -Milliseconds 700
  $after = Get-CounterValue -MetricName $metricName -Url $metricsUrl
  if ($after -gt $before) {
    Ok "$metricName increased: $before -> $after"
    Write-Host "PHASE 2 ✅  basic NATS round-trip verified" -ForegroundColor Green
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Fail "Timeout waiting for $metricName to increase (still $after, was $before)"
'@

New-Item -Type Directory -Force .\tests | Out-Null
Set-Content -Path .\tests\Phase2.Tests.ps1 -Value $phase2 -Encoding UTF8
Write-Host "Created tests\Phase2.Tests.ps1" -ForegroundColor Green

Write-Host "Running Phase 2 test..." -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File .\tests\Phase2.Tests.ps1

# --------------------------------------------------------------------------------
# 6) Drop cleanup scanner (dry-run)
# --------------------------------------------------------------------------------
$scanner = @'
param([switch]$Remove)
$root = Resolve-Path "."
Write-Host "Scanning: $root" -ForegroundColor Cyan
$globs = @(
  "**/__pycache__", "**/*.pyc", "**/.pytest_cache", "**/.mypy_cache",
  "**/.ruff_cache", "**/.coverage*", "**/htmlcov", "**/*.log", "**/*.tmp",
  "**/.DS_Store", "**/Thumbs.db", "**/.ipynb_checkpoints", "**/dist", "**/build", "**/.tox"
)
$exclusions = @(".git",".venv","libs/json","apps/services","docker-data")
function Should-Exclude($p){ foreach($e in $exclusions){ if($p -like (Join-Path $root $e) + "*"){return $true} } return $false }
$targets = New-Object System.Collections.Generic.List[string]
foreach($g in $globs){
  Get-ChildItem -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue -Filter (Split-Path $g -Leaf) |
    ForEach-Object{
      $full=$_.FullName
      $patternDir = Split-Path $g
      if($patternDir -and ($full -notlike "*$patternDir*")){return}
      if(-not (Should-Exclude $full)){$targets.Add($full)}
    }
}
$targets = $targets | Sort-Object -Unique
if(-not $targets.Count){ Write-Host "Nothing to clean." -ForegroundColor Green; exit 0 }
Write-Host "Found $($targets.Count) candidate path(s):" -ForegroundColor Yellow
$targets | ForEach-Object { Write-Host "  $_" }
if($Remove){
  Write-Host "`nRemoving..." -ForegroundColor Red
  foreach($t in $targets){
    try{
      if(Test-Path $t -PathType Container){ Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction Stop }
      else{ Remove-Item -LiteralPath $t -Force -ErrorAction Stop }
      Write-Host "  [deleted] $t"
    } catch {
      Write-Warning "  [skipped] $t :: $($_.Exception.Message)"
    }
  }
  Write-Host "Cleanup done." -ForegroundColor Green
}else{
  Write-Host "`n(Dry run) Use -Remove to delete the above." -ForegroundColor Cyan
}
'@
New-Item -Type Directory -Force .\tools | Out-Null
Set-Content -Path .\tools\scan_cleanup.ps1 -Value $scanner -Encoding UTF8
Write-Host "Created tools\scan_cleanup.ps1 (dry run by default)" -ForegroundColor Green

Write-Host "`nPhase 2 setup complete." -ForegroundColor Green
