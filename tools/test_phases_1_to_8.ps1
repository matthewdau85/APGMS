<#  
  tools\test_phases_1_to_8.ps1
  Runs quick checks for APGMS phases 1-8 and writes a Markdown report (phase_report.md) in the repo root.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\test_phases_1_to_8.ps1
#>

#region pretty output
function Info { param([string]$m) Write-Host "[ INFO ] $m" -ForegroundColor Cyan }
function Ok   { param([string]$m) Write-Host "[  OK  ] $m" -ForegroundColor Green }
function Warn { param([string]$m) Write-Host "[ WARN ] $m" -ForegroundColor Yellow }
function Err  { param([string]$m) Write-Host "[ ERR  ] $m" -ForegroundColor Red }
#endregion

#region robust repo root resolver
function Get-RepoRoot {
  param([string]$StartPath)
  if (-not $StartPath -or [string]::IsNullOrWhiteSpace($StartPath)) {
    $StartPath = $MyInvocation.MyCommand.Path
  }
  if (-not $StartPath -or [string]::IsNullOrWhiteSpace($StartPath)) {
    $StartPath = (Get-Location).Path
  }
  $scriptDir = Split-Path -Path $StartPath -Parent
  if (-not $scriptDir -or [string]::IsNullOrWhiteSpace($scriptDir)) {
    $scriptDir = (Get-Location).Path
  }
  return (Resolve-Path (Join-Path $scriptDir '..')).Path
}

$RepoRoot = Get-RepoRoot $PSCommandPath
Set-Location $RepoRoot
Info "Repo root: $RepoRoot"
#endregion

#region helpers
function Test-HttpOk {
  param(
    [Parameter(Mandatory)] [string] $Url,
    [int] $TimeoutSeconds = 15
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $Url
      if ($res.StatusCode -eq 200) { return $true }
    } catch { Start-Sleep -Milliseconds 700 }
    Start-Sleep -Milliseconds 300
  }
  return $false
}

function Compose-Port {
  param([string]$Service, [int]$Port)
  try {
    $out = & docker compose port $Service $Port 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { return $out.Trim() }
  } catch { }
  return $null
}

function Get-Compose-Network {
  try {
    $cid = (& docker compose ps -q nats).Trim()
    if (-not $cid) { return $null }
    $inspect = docker inspect $cid | ConvertFrom-Json
    $props = $inspect[0].NetworkSettings.Networks.PSObject.Properties
    if ($props -and $props.Name) {
      return ($props | Select-Object -First 1).Name
    }
  } catch { }
  return $null
}
#endregion

#region phase checks
$rows = @()

# --- Phase 1: Repo/compose sane (no top-level version key)
$composePath = Join-Path $RepoRoot 'docker-compose.yml'
$okCompose = $false
$notes1 = ''
if (Test-Path $composePath) {
  $text = Get-Content -Raw -Encoding UTF8 $composePath

  # single-quoted here-string so regex is literal
  $patternVersion = @'
^\s*version\s*:\s*(".*?"|'.*?'|[0-9\.]+)\s*$
'@

  $hasVersion = ($text -split "`r?`n") | Where-Object { $_ -match $patternVersion } | Measure-Object | Select-Object -ExpandProperty Count
  if ($hasVersion -gt 0) {
    $notes1 = "'version:' key is present - remove it for modern Compose."
  } else {
    $okCompose = $true
    $notes1 = "docker-compose.yml present and no legacy 'version:' key."
  }
} else {
  $notes1 = "docker-compose.yml missing."
}
$rows += [ordered]@{ Phase = 'Phase 1 (Repo ready)'; Status = ($(if ($okCompose) {'OK'} else {'FAIL'})); Notes = $notes1 }

# --- Ensure core services are up (nats, normalizer, tax-engine)
Info "Ensuring services are up (nats, normalizer, tax-engine)..."
& docker compose up -d nats normalizer tax-engine | Out-Null

# --- Phase 2: Infra health (NATS monitoring)
$okNatsMon = Test-HttpOk -Url 'http://127.0.0.1:8222/healthz' -TimeoutSeconds 15
$rows += [ordered]@{ Phase = 'Phase 2 (NATS monitoring)'; Status = ($(if ($okNatsMon){'OK'} else {'FAIL'})); Notes = ($(if ($okNatsMon){'NATS monitoring /healthz = 200'} else {'NATS monitoring not healthy'})) }

# --- Phase 3: Normalizer health + port mapping
$okNorm = Test-HttpOk -Url 'http://127.0.0.1:8001/healthz' -TimeoutSeconds 15
$normPort = Compose-Port -Service 'normalizer' -Port 8001
$noteNorm = @()
$noteNorm += ($(if ($okNorm){'healthz=200'} else {'healthz failed'}))
if ($normPort) { $noteNorm += "port: $normPort" } else { $noteNorm += "no published port" }
$rows += [ordered]@{ Phase = 'Phase 3 (Normalizer)'; Status = ($(if ($okNorm){'OK'} else {'FAIL'})); Notes = ($noteNorm -join '; ') }

# --- Phase 4: Tax Engine health + port mapping
$okTax = Test-HttpOk -Url 'http://127.0.0.1:8002/healthz' -TimeoutSeconds 15
$taxPort = Compose-Port -Service 'tax-engine' -Port 8002
$noteTax = @()
$noteTax += ($(if ($okTax){'healthz=200'} else {'healthz failed'}))
if ($taxPort) { $noteTax += "port: $taxPort" } else { $noteTax += "no published port" }
$rows += [ordered]@{ Phase = 'Phase 4 (Tax Engine)'; Status = ($(if ($okTax){'OK'} else {'FAIL'})); Notes = ($noteTax -join '; ') }

# --- Phase 5: Publish a test message to NATS subject apgms.tx.calculate
$okPub = $false
$pubNote = ''
$net = Get-Compose-Network
if (-not $net) {
  $pubNote = "Could not determine compose network."
} else {
  try {
    $tmp = New-TemporaryFile
    '{"ping":"ok","amount":123.45}' | Set-Content -Encoding UTF8 -NoNewline $tmp.FullName

    $Subject = 'apgms.tx.calculate'
    # tiny /bin/sh script with safe subject substitution
    $script = @'
MSG=$(cat /tmp/payload.json)
exec /usr/local/bin/nats --server nats://nats:4222 pub "__SUBJECT__" "$MSG"
'@
    $script = $script.Replace('__SUBJECT__', $Subject)

    $args = @(
      '--rm',
      '--network', $net,
      '-v', "$($tmp.FullName):/tmp/payload.json:ro",
      '--entrypoint', '/bin/sh',
      'synadia/nats-box:latest',
      '-lc', $script
    )
    & docker run @args | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $okPub = $true
      $pubNote = "Published test payload to $Subject"
    } else {
      $pubNote = "nats publish non-zero exit ($LASTEXITCODE)"
    }
  } catch {
    $pubNote = "Publish failed: $($_.Exception.Message)"
  } finally {
    if ($tmp -and (Test-Path $tmp.FullName)) { Remove-Item $tmp.FullName -Force -ErrorAction SilentlyContinue }
  }
}
$rows += [ordered]@{ Phase = 'Phase 5 (NATS publish)'; Status = ($(if ($okPub){'OK'} else {'FAIL'})); Notes = $pubNote }

# --- Phase 6: Metrics stack present (Prometheus)
$promOk = Test-HttpOk -Url 'http://127.0.0.1:9090/targets' -TimeoutSeconds 5
$rows += [ordered]@{ Phase = 'Phase 6 (Metrics/Prometheus)'; Status = ($(if ($promOk){'OK'} else {'WARN'})); Notes = ($(if ($promOk){'Prometheus reachable'} else {'Prometheus not reachable'}) ) }

# --- Phase 7: Grafana reachable (alerts provisioning assumed)
$grafOk = Test-HttpOk -Url 'http://127.0.0.1:3000/login' -TimeoutSeconds 5
$rows += [ordered]@{ Phase = 'Phase 7 (Grafana)'; Status = ($(if ($grafOk){'OK'} else {'WARN'})); Notes = ($(if ($grafOk){'Grafana login reachable'} else {'Grafana not reachable'}) ) }

# --- Phase 8: CI files present
$ciPath = Join-Path $RepoRoot '.github/workflows/ci.yml'
$ciOk = Test-Path $ciPath
$rows += [ordered]@{ Phase = 'Phase 8 (CI wiring)'; Status = ($(if ($ciOk){'OK'} else {'FAIL'})); Notes = ($(if ($ciOk){'.github/workflows/ci.yml present'} else {'Missing CI workflow file'}) ) }
#endregion

#region emit report
$report = @()
$report += "# APGMS Phases 1-8 Check"
$report += ""
$report += "| Phase | Status | Notes |"
$report += "|---|---|---|"
foreach ($r in $rows) {
  $report += "| $($r.Phase) | $($r.Status) | $($r.Notes) |"
}
$okCount = ($rows | Where-Object { $_.Status -eq 'OK' }).Count
$total   = $rows.Count
$report += ""
$report += "**Summary:** $okCount / $total OK"

$reportPath = Join-Path $RepoRoot 'phase_report.md'
$report -join "`r`n" | Set-Content -Encoding UTF8 $reportPath
Ok "Wrote report: $reportPath"

Write-Host ""
Write-Host "---- Summary ----" -ForegroundColor Cyan
$rows | ForEach-Object {
  $c = if ($_.Status -eq 'OK') { 'Green' } elseif ($_.Status -eq 'WARN') { 'Yellow' } else { 'Red' }
  Write-Host ("{0,-28} {1,-5} {2}" -f $_.Phase, $_.Status, $_.Notes) -ForegroundColor $c
}
Write-Host ("{0}/{1} OK" -f $okCount, $total) -ForegroundColor Cyan
#endregion
