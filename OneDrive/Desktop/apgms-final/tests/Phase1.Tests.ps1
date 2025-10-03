<#  tests/Phase1.Tests.ps1
    Phase 1 readiness checks:
      - pytest passes in venv
      - required schema files exist
      - docker compose up (nats, normalizer, tax-engine, postgres)
      - healthz for nats, normalizer, tax-engine
      - normalizer accepts a minimal POS event
      - normalizer rejects an invalid POS event (expects 4xx)
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
Set-Location (Resolve-Path "$root\..")

function Fail($msg) { Write-Error $msg; exit 1 }
function Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[ OK ] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Warning $msg }

function Test-HttpOk {
  param(
    [Parameter(Mandatory)] [string] $Url,
    [int] $TimeoutSec = 45,
    [int] $RetryMs = 1000
  )
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return $r }
    } catch {
      Start-Sleep -Milliseconds $RetryMs
    }
  }
  Fail "HTTP not healthy after $TimeoutSec sec: $Url"
}

# --- 1) Pytest in the venv -----------------------------------------------------
$python = if (Test-Path .\.venv\Scripts\python.exe) { ".\.venv\Scripts\python.exe" } else { "python" }
Info "Running pytest with: $python"
$pytest = Start-Process -FilePath $python -ArgumentList "-m","pytest","-q" -NoNewWindow -PassThru -Wait
if ($pytest.ExitCode -ne 0) { Fail "pytest failed (exit $($pytest.ExitCode))" } else { Ok "pytest: all tests passed" }

# --- 2) Schema files exist -----------------------------------------------------
$schemas = @(
  "libs/json/payroll_event.v1.json",
  "libs/json/pos_event.v1.json",
  "libs/json/bank_event.v1.json"
)
$missing = @()
foreach ($s in $schemas) {
  if (Test-Path $s) { Ok "found schema: $s" } else { $missing += $s; Write-Host "[MISS] $s" -ForegroundColor Yellow }
}
if ($missing.Count) { Fail "Missing schema file(s): `n - " + ($missing -join "`n - ") }

# --- 3) Docker compose up (phase 1 services) ----------------------------------
Info "Ensuring Docker is up"
try { docker version | Out-Null } catch { Fail "Docker is not available in PATH" }
try { docker compose version | Out-Null } catch { Fail "Docker Compose v2 not available (docker compose)" }

Info "Bringing up services..."
docker compose up -d nats postgres normalizer tax-engine | Out-Null

# --- 4) Health checks ----------------------------------------------------------
# NATS (monitoring)
Ok "Waiting for NATS /healthz"
$rNats = Test-HttpOk -Url "http://127.0.0.1:8222/healthz" -TimeoutSec 60
Ok "NATS healthy: $($rNats.StatusCode) $($rNats.Content.Trim())"

# Normalizer
Ok "Waiting for normalizer /healthz"
$rNorm = Test-HttpOk -Url "http://127.0.0.1:8001/healthz" -TimeoutSec 60
Ok "Normalizer healthy: $($rNorm.StatusCode)"

# Tax engine
Ok "Waiting for tax-engine /healthz"
$rTax = Test-HttpOk -Url "http://127.0.0.1:8002/healthz" -TimeoutSec 60
Ok "Tax engine healthy: $($rTax.StatusCode)"

# --- 5) Normalizer accepts a minimal POS event --------------------------------
$evt = @{
  event_type = "pos"
  lines      = @(@{
    sku = "ABC"; qty = 2; unit_price_cents = 500; tax_code = "GST"
  })
} | ConvertTo-Json

Info "Posting POS event to normalizer /ingest (valid)"
try {
  $resp = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8001/ingest" -Body $evt -ContentType 'application/json' -TimeoutSec 10
  Ok "Normalizer accepted POS event"
} catch {
  $webResp = $_.Exception.Response
  if ($webResp) {
    $status = [int]$webResp.StatusCode
    $body   = (New-Object IO.StreamReader($webResp.GetResponseStream())).ReadToEnd()
    Fail "Normalizer rejected POS event ($status): $body"
  } else {
    throw
  }
}

# --- 6) Invalid POS event should be rejected (expects 4xx) --------------------
$badEvt = @{ event_type = "pos" } | ConvertTo-Json
Info "Posting INVALID POS event to normalizer /ingest (should be 4xx)"
try {
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8001/ingest" -Body $badEvt -ContentType 'application/json' -TimeoutSec 10
  Fail "Normalizer accepted an invalid POS event (expected 4xx)"
} catch {
  $status = [int]$_.Exception.Response.StatusCode
  if ($status -lt 400 -or $status -ge 500) {
    Fail "Expected 4xx for invalid event, got HTTP $status"
  } else {
    Ok "Normalizer correctly rejected invalid POS event (HTTP $status)"
  }
}

Write-Host ""
Write-Host "PHASE 1 ✅  ALL CHECKS PASSED" -ForegroundColor Green
exit 0
