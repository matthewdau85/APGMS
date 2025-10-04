$ErrorActionPreference = 'Stop'
function Fail($m){ Write-Error $m; exit 1 }
function Ok($m){ Write-Host "[ OK ] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

function Test-HttpOk {
  param([string]$Url,[int]$TimeoutSec=45,[int]$RetryMs=700)
  $sw=[Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    try {
      $r=Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return $true }
    } catch { Start-Sleep -Milliseconds $RetryMs }
  }
  return $false
}

function Get-Metric {
  param([string]$MetricName, [string]$Url)
  $txt = (Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5).Content
  $line = $txt -split "`n" | Where-Object { $_ -match "^\s*$([regex]::Escape($MetricName))(\{[^\}]*\})?\s" } | Select-Object -First 1
  if (-not $line) { return $null }
  return [double]($line -split '\s+')[-1]
}

Info "Ensuring docker services are up"
docker compose up -d nats postgres normalizer tax-engine | Out-Null

Info "Waiting for NATS /healthz"
if (-not (Test-HttpOk "http://127.0.0.1:8222/healthz" 60)) { Fail "NATS not healthy" } else { Ok "NATS healthy" }

Info "Waiting for normalizer /healthz"
if (-not (Test-HttpOk "http://127.0.0.1:8001/healthz" 60)) { Fail "Normalizer not healthy" } else { Ok "Normalizer healthy" }

Info "Waiting for tax-engine /healthz"
if (-not (Test-HttpOk "http://127.0.0.1:8002/healthz" 60)) { Fail "Tax-engine not healthy" } else { Ok "Tax-engine healthy" }

$metricsUrl = "http://127.0.0.1:8002/metrics"
$metricName = "apgms_tax_engine_events_consumed_total"

Info "Waiting for tax-engine /metrics"
$deadline = (Get-Date).AddSeconds(30)
do { try { $null = Invoke-WebRequest -UseBasicParsing -Uri $metricsUrl -TimeoutSec 5; break } catch { Start-Sleep -Milliseconds 800 } } while ((Get-Date) -lt $deadline)
Ok "/metrics reachable"

$before = Get-Metric -MetricName $metricName -Url $metricsUrl
if ($null -eq $before) { Fail "Metric $metricName not found at $metricsUrl" }
Info "Counter before: $before"

$evt = @{
  event_type = "pos"
  lines      = @(@{ sku="SKU-123"; qty=3; unit_price_cents=400; tax_code="GST" })
} | ConvertTo-Json

Info "Posting POS to /ingest"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8001/ingest" -Body $evt -ContentType 'application/json' -TimeoutSec 10 | Out-Null
Ok "POS accepted by normalizer"

$debugUrl = "http://127.0.0.1:8001/debug/last-tax"
$deadline = (Get-Date).AddSeconds(20)
$result = $null
do {
  Start-Sleep -Milliseconds 700
  try {
    $result = Invoke-RestMethod -Method Get -Uri $debugUrl -TimeoutSec 5
    if ($result -and $result.event_type -eq "pos_tax_result") { break }
  } catch { }
} while ((Get-Date) -lt $deadline)

if (-not $result) { Fail "No tax result observed on $debugUrl" }
if ($result.total_tax_cents -lt 0) { Fail "total_tax_cents invalid: $($result.total_tax_cents)" }
if (-not $result.lines -or -not $result.lines[0].ContainsKey("gst_cents")) { Fail "gst_cents not present on line" }
Ok "Received tax result: total_tax_cents=$($result.total_tax_cents)"

$after = Get-Metric -MetricName $metricName -Url $metricsUrl
if ($after -le $before) { Fail "$metricName did not increase ($before -> $after)" }
Ok "$metricName increased: $before -> $after"

Write-Host "PHASE 3 âœ…  result published to NATS and observed via normalizer debug" -ForegroundColor Green
