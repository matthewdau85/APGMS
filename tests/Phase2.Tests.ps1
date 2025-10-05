# tests/Phase2.Tests.ps1
# Phase 2 verification: NATS round-trip from normalizer -> tax-engine and metric increments

$ErrorActionPreference = 'Stop'

function Fail($m){ Write-Error $m; exit 1 }
function Ok($m){ Write-Host "[ OK ] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

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

# Reads a Prometheus counter or gauge value, supporting optional label match like: LabelSelector 'type="pos"'
function Get-CounterValue {
  param(
    [Parameter(Mandatory)] [string]$MetricName,
    [Parameter(Mandatory)] [string]$Url,
    [string]$LabelSelector = ''   # e.g. 'type="pos"'
  )
  $content = (Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5).Content
  $lines = $content -split "`n"

  $nameEsc = [regex]::Escape($MetricName)
  $pattern = if ($LabelSelector -and $LabelSelector.Trim() -ne '') {
    "^\s*$nameEsc\{[^}]*$([regex]::Escape($LabelSelector))[^}]*\}\s+([0-9.eE+-]+)\s*$"
  } else {
    "^\s*$nameEsc(?:\{[^}]*\})?\s+([0-9.eE+-]+)\s*$"
  }

  foreach ($line in $lines) {
    $m = [regex]::Match($line, $pattern)
    if ($m.Success) {
      return [double]$m.Groups[1].Value
    }
  }
  return $null
}

# --- 0) Bring up services (Phase 2 set) ----------------------------------------
Info "Ensuring docker services are up"
docker compose up -d nats postgres normalizer tax-engine | Out-Null

# --- 1) Health checks -----------------------------------------------------------
Info "Waiting for NATS /healthz"
if (-not (Test-HttpOk "http://127.0.0.1:8222/healthz" 60)) { Fail "NATS not healthy on /healthz" }
Ok "NATS healthy"

Info "Waiting for normalizer /healthz"
if (-not (Test-HttpOk "http://127.0.0.1:8001/healthz" 60)) { Fail "Normalizer not healthy on /healthz" }
Ok "Normalizer healthy"

Info "Waiting for tax-engine /healthz"
if (-not (Test-HttpOk "http://127.0.0.1:8002/healthz" 60)) { Fail "Tax-engine not healthy on /healthz" }
Ok "Tax-engine healthy"

# --- 2) Ensure /metrics is reachable ------------------------------------------
$metricsUrl = "http://127.0.0.1:8002/metrics"
$metricName = "apgms_tax_engine_events_consumed_total"
$label      = 'type="pos"'

Info "Waiting for tax-engine /metrics"
if (-not (Test-HttpOk $metricsUrl 60)) { Fail "Tax-engine /metrics not reachable" }
Ok "/metrics reachable"

# Give the process a moment to register the counter
Start-Sleep -Milliseconds 500

# --- 3) Read baseline counter ---------------------------------------------------
$before = Get-CounterValue -MetricName $metricName -Url $metricsUrl -LabelSelector $label
if ($null -eq $before) {
  # Try without labels in case the series hasn't been created yet
  $before = Get-CounterValue -MetricName $metricName -Url $metricsUrl
}
if ($null -eq $before) {
  Fail "Metric '$metricName' not found at $metricsUrl. Check that the tax-engine patched code registers the Counter."
}
Info "Counter before: $before"

# --- 4) Send a valid POS event to normalizer -----------------------------------
$evt = @{
  event_type = "pos"
  lines      = @(
    @{ sku="ABC"; qty=2; unit_price_cents=500; tax_code="GST" }
  )
} | ConvertTo-Json

Info "Posting POS to /ingest"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8001/ingest" -Body $evt -ContentType 'application/json' -TimeoutSec 10 | Out-Null
Ok "POS accepted by normalizer"

# --- 5) Poll for counter increase ----------------------------------------------
$deadline = (Get-Date).AddSeconds(25)
$after = $before
do {
  Start-Sleep -Milliseconds 700
  $after = Get-CounterValue -MetricName $metricName -Url $metricsUrl -LabelSelector $label
  if ($null -eq $after) {
    # If the labeled series is not present yet, check any series for this metric
    $after = Get-CounterValue -MetricName $metricName -Url $metricsUrl
  }
  if ($after -gt $before) {
    Ok "$metricName increased: $before -> $after"
    Write-Host "PHASE 2 ✅  NATS round-trip verified (normalizer → tax-engine → metric)" -ForegroundColor Green
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Fail "Timeout waiting for $metricName to increase (still $after, was $before)"
