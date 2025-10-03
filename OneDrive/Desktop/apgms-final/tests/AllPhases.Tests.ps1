<#  tests/AllPhases.Tests.ps1

Covers:
  Phase 1
    - pytest passes in venv
    - required schema files exist
    - docker compose up (nats, normalizer, tax-engine, postgres)
    - healthz for nats, normalizer, tax-engine
    - normalizer accepts a minimal POS event
    - normalizer rejects an invalid POS event (expects 4xx)

  Phase 2
    - tax-engine exposes Prometheus metrics
    - publishing POS via /ingest increments apgms_tax_engine_events_consumed_total

Run:
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
  powershell -ExecutionPolicy Bypass -File .\tests\AllPhases.Tests.ps1
#>

$ErrorActionPreference = 'Stop'

# --------------------------- helpers ---------------------------
function Fail($msg) { Write-Error $msg; exit 1 }
function Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[ OK ] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Warning $msg }

function Get-RepoRoot {
  if ($PSCommandPath -and (Test-Path $PSCommandPath)) {
    return (Split-Path -Parent $PSCommandPath | Split-Path -Parent)
  }
  return (Resolve-Path ".").Path
}

function Test-HttpOk {
  param(
    [Parameter(Mandatory)] [string] $Url,
    [int] $TimeoutSec = 45,
    [int] $RetryMs = 800
  )
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return $true }
    } catch {
      Start-Sleep -Milliseconds $RetryMs
    }
  }
  return $false
}

function Get-CounterValue {
  param(
    [Parameter(Mandatory)][string]$MetricName,
    [Parameter(Mandatory)][string]$Url
  )
  $txt = (Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5).Content
  $line = $txt -split "`n" | Where-Object { $_ -match "^\s*$([regex]::Escape($MetricName))(\{| )" } | Select-Object -First 1
  if (-not $line) { return $null }
  return [double]($line -split '\s+')[-1]
}

# --------------------------- config ---------------------------
$root = Get-RepoRoot
Set-Location $root

$python = if (Test-Path .\.venv\Scripts\python.exe) { ".\.venv\Scripts\python.exe" } else { "python" }

$schemas = @(
  "libs/json/payroll_event.v1.json",
  "libs/json/pos_event.v1.json",
  "libs/json/bank_event.v1.json"
)

$urls = @{
  natsHealth = "http://127.0.0.1:8222/healthz"
  normHealth = "http://127.0.0.1:8001/healthz"
  taxHealth  = "http://127.0.0.1:8002/healthz"
  taxMetrics = "http://127.0.0.1:8002/metrics"
  ingest     = "http://127.0.0.1:8001/ingest"
}

$metricName = "apgms_tax_engine_events_consumed_total"

# --------------------------- Phase 1 ---------------------------
# 1) pytest
Info "Running pytest with: $python"
$pytest = Start-Process -FilePath $python -ArgumentList "-m","pytest","-q" -NoNewWindow -PassThru -Wait
if ($pytest.ExitCode -ne 0) { Fail "pytest failed (exit $($pytest.ExitCode))" } else { Ok "pytest: all tests passed" }

# 2) schema files
$missing = @()
foreach ($s in $schemas) {
  if (Test-Path $s) { Ok "found schema: $s" } else { $missing += $s; Write-Host "[MISS] $s" -ForegroundColor Yellow }
}
if ($missing.Count) { Fail "Missing schema file(s): `n - " + ($missing -join "`n - ") }

# 3) docker up
Info "Ensuring Docker is up"
try { docker version | Out-Null } catch { Fail "Docker is not available in PATH" }
try { docker compose version | Out-Null } catch { Fail "Docker Compose v2 not available (docker compose)" }

Info "Bringing up services..."
docker compose up -d nats postgres normalizer tax-engine | Out-Null

# 4) health checks
Info "Waiting for NATS /healthz"
if (-not (Test-HttpOk $urls.natsHealth 60)) { Fail "NATS not healthy" } else { Ok "NATS healthy" }

Info "Waiting for normalizer /healthz"
if (-not (Test-HttpOk $urls.normHealth 60)) { Fail "Normalizer not healthy" } else { Ok "Normalizer healthy" }

Info "Waiting for tax-engine /healthz"
if (-not (Test-HttpOk $urls.taxHealth 60)) { Fail "Tax-engine not healthy" } else { Ok "Tax-engine healthy" }

# 5) normalizer accepts a minimal POS
$evt = @{
  event_type = "pos"
  lines      = @(@{ sku="ABC"; qty=2; unit_price_cents=500; tax_code="GST" })
} | ConvertTo-Json

Info "Posting POS event to normalizer /ingest (valid)"
try {
  Invoke-RestMethod -Method Post -Uri $urls.ingest -Body $evt -ContentType 'application/json' -TimeoutSec 10 | Out-Null
  Ok "Normalizer accepted POS event"
} catch {
  $webResp = $_.Exception.Response
  $status = if ($webResp) { [int]$webResp.StatusCode } else { -1 }
  $body = ""
  if ($webResp) {
    try { $body = (New-Object IO.StreamReader($webResp.GetResponseStream())).ReadToEnd() } catch {}
  }
  Fail "Normalizer rejected valid POS event (HTTP $status): $body"
}

# 6) normalizer rejects an invalid POS
$badEvt = @{ event_type = "pos" } | ConvertTo-Json
Info "Posting INVALID POS event to /ingest (expect 4xx)"
try {
  Invoke-RestMethod -Method Post -Uri $urls.ingest -Body $badEvt -ContentType 'application/json' -TimeoutSec 10 | Out-Null
  Fail "Normalizer accepted an invalid POS event (expected 4xx)"
} catch {
  $status = -1
  if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
  if ($status -lt 400 -or $status -ge 500) {
    Fail "Expected 4xx for invalid event, got HTTP $status"
  } else {
    Ok "Normalizer correctly rejected invalid POS event (HTTP $status)"
  }
}

Write-Host ""
Write-Host "PHASE 1 ✅  ALL CHECKS PASSED" -ForegroundColor Green

# --------------------------- Phase 2 ---------------------------
# 1) metrics endpoint reachable
Info "Waiting for tax-engine /metrics"
$deadline = (Get-Date).AddSeconds(30)
$metricsOk = $false
do {
  try { $null = Invoke-WebRequest -UseBasicParsing -Uri $urls.taxMetrics -TimeoutSec 5; $metricsOk = $true; break }
  catch { Start-Sleep -Milliseconds 800 }
} while ((Get-Date) -lt $deadline)

if (-not $metricsOk) { Fail "Tax-engine /metrics not reachable" } else { Ok "/metrics reachable" }

# 2) read counter before
$before = Get-CounterValue -MetricName $metricName -Url $urls.taxMetrics
if ($null -eq $before) { Fail "Metric $metricName not found at $($urls.taxMetrics)" }
Info "Counter before: $before"

# 3) post a valid POS to drive NATS → tax-engine
Info "Posting POS to /ingest"
Invoke-RestMethod -Method Post -Uri $urls.ingest -Body $evt -ContentType 'application/json' -TimeoutSec 10 | Out-Null
Ok "POS accepted by normalizer"

# 4) poll for counter increase
$deadline = (Get-Date).AddSeconds(25)
do {
  Start-Sleep -Milliseconds 700
  $after = Get-CounterValue -MetricName $metricName -Url $urls.taxMetrics
  if ($after -gt $before) {
    Ok "$metricName increased: $before -> $after"
    Write-Host "PHASE 2 ✅  NATS round-trip verified (normalizer → tax-engine → metric)" -ForegroundColor Green
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Fail "Timeout waiting for $metricName to increase (still $after, was $before)"
