<# 
Phase 4 E2E Smoke for apgms-final
Run:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\phase4_e2e.ps1
Optional params:
  -Subject 'events.raw' -PayloadPath .\my.json -CreateStream -StreamName 'EVENTS'
#>

[CmdletBinding()]
param(
  [string]$Subject,
  [string]$PayloadPath,
  [switch]$CreateStream,
  [string]$StreamName = 'EVENTS',
  [int]$HealthTimeoutSec = 15,
  [int]$LogTailLines = 200,
  [int]$LogFollowSeconds = 0
)

### Helpers
function Info($m) { Write-Host "[ INFO ] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[ OK ]  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[ WARN ] $m" -ForegroundColor Yellow }
function Err($m)  { Write-Host "[ ERR ] $m" -ForegroundColor Red }
function Die($m)  { Err $m; exit 1 }

function Get-RepoRoot {
  # Be robust across -File, dot-source, or other invocations
  $path = $null
  if ($PSCommandPath) { $path = $PSCommandPath }
  elseif ($MyInvocation -and $MyInvocation.MyCommand -and $MyInvocation.MyCommand.Path) { $path = $MyInvocation.MyCommand.Path }
  if ($path) {
    try {
      $scriptDir = Split-Path -LiteralPath $path -Parent
      return (Split-Path -LiteralPath $scriptDir -Parent)
    } catch { }
  }
  # Fallback: assume we're already in repo root (where docker-compose.yml lives)
  $candidate = Get-Location
  return $candidate.Path
}

function Run([string[]]$Cmd) {
  if (-not $Cmd -or $Cmd.Count -eq 0) { Die "Run(): empty command" }
  Info ("`$ " + ($Cmd -join ' '))
  & $Cmd[0] $Cmd[1..($Cmd.Count-1)]
  if ($LASTEXITCODE -ne 0) { Die "Command failed with exit code $LASTEXITCODE" }
}

function TryRun([string[]]$Cmd) {
  if (-not $Cmd -or $Cmd.Count -eq 0) { return 1 }
  Info ("`$ " + ($Cmd -join ' '))
  & $Cmd[0] $Cmd[1..($Cmd.Count-1)]
  return $LASTEXITCODE
}

function Probe-Http([string]$Name, [string]$Url, [int]$TimeoutSec) {
  Info "Probing $Name at $Url ..."
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5 -Headers @{ 'Connection'='close' }
      if ($resp.StatusCode -eq 200) { Ok "$Name healthy ($($resp.StatusCode)) : $($resp.Content)"; return $true }
      Warn "$Name returned $($resp.StatusCode)"
    } catch {
      Start-Sleep -Milliseconds 500
    }
  } while ((Get-Date) -lt $deadline)
  Warn "$Name did not return 200 within $TimeoutSec s"
  return $false
}

function Detect-Compose-Network {
  $cid = (docker compose ps -q nats)
  if (-not $cid) { Die "NATS container not found; did docker compose start?" }
  $net = docker inspect $cid --format '{{range $k,$v := .NetworkSettings.Networks}}{{printf "%s" $k}}{{end}}'
  if (-not $net) { Die "Could not detect docker compose network for NATS container." }
  return $net
}

function AutoDetect-Subject([string]$RootPath) {
  $candidates = @()
  $searchRoots = @(
    (Join-Path $RootPath 'apps\services\event-normalizer\app'),
    $RootPath
  ) | Where-Object { Test-Path $_ }

  $patterns = @(
    'os\.getenv\(\s*["'']NATS_SUBJECT["'']\s*,\s*["'']([^"'']+)["'']\s*\)',
    'subscribe\(\s*["'']([^"'']+)["'']',
    'subjects?\s*:\s*["'']([^"'']+)["'']'
  )

  foreach ($base in $searchRoots) {
    $files = Get-ChildItem -Path $base -Recurse -File |
      Where-Object { $_.Name -match '\.(py|ya?ml|toml|json|ts|js)$' }
    foreach ($f in $files) {
      $text = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue
      if (-not $text) { continue }
      foreach ($pat in $patterns) {
        $m = [regex]::Matches($text, $pat)
        foreach ($mm in $m) {
          $subj = $mm.Groups[1].Value.Trim()
          if ($subj) { $candidates += $subj }
        }
      }
    }
    if ($candidates.Count -gt 0) { break }
  }

  $uniq = $candidates | Group-Object | Sort-Object Count -Descending | Select-Object -First 1 -ExpandProperty Name
  if ($uniq) { return $uniq }
  return 'events.raw'
}

### MAIN
$RepoRoot = Get-RepoRoot
Set-Location $RepoRoot
Info "Repo root: $RepoRoot"

# 1) Ensure services up
Info "Starting/ensuring nats, normalizer, tax-engine..."
Run @('docker','compose','up','-d','nats','normalizer','tax-engine')

# 2) Probe health
$okNats = Probe-Http -Name 'NATS (monitoring)' -Url 'http://127.0.0.1:8222/healthz' -TimeoutSec $HealthTimeoutSec
$okNorm = Probe-Http -Name 'normalizer' -Url 'http://127.0.0.1:8001/healthz' -TimeoutSec $HealthTimeoutSec
$okTax  = Probe-Http -Name 'tax-engine' -Url 'http://127.0.0.1:8002/healthz' -TimeoutSec $HealthTimeoutSec

if (-not ($okNats -and $okNorm -and $okTax)) {
  Warn "Some services did not pass health probe; continuing so you can inspect logs..."
}

# 3) Determine NATS subject
if (-not $Subject) {
  $Subject = AutoDetect-Subject -RootPath $RepoRoot
  Ok "Detected subject: $Subject"
} else {
  Ok "Using provided subject: $Subject"
}

# 4) Determine compose network (for nats-box)
$net = Detect-Compose-Network
Ok "Using docker network: $net"

# 5) Optionally create a stream that covers the subject
if ($CreateStream.IsPresent) {
  Info "Creating JetStream stream '$StreamName' for subject '$Subject' (idempotent)..."
  $cmd = @(
    'docker','run','--rm','--network', $net,
    'synadia/nats-box:latest','sh','-lc',
    "nats --server nats://nats:4222 stream add $StreamName --subjects '$Subject' --retention limits --max-msgs -1 --storage file --discard old --replicas 1 --defaults --no-validate || true"
  )
  $rc = TryRun $cmd
  if ($rc -eq 0) { Ok "Stream ensured." } else { Warn "Stream ensure returned code $rc (continuing)"; }
}

# 6) Prepare payload
$tmpJson = Join-Path $env:TEMP "phase4_payload.json"

if ($PayloadPath) {
  if (-not (Test-Path $PayloadPath)) { Die "PayloadPath not found: $PayloadPath" }
  Copy-Item -LiteralPath $PayloadPath -Destination $tmpJson -Force
} else {
  $defaultJson = @{
    id        = "demo-$(Get-Random -Minimum 1000 -Maximum 9999)"
    type      = "sale"
    amount    = 123.45
    currency  = "USD"
    timestamp = (Get-Date -AsUTC).ToString("s") + "Z"
  } | ConvertTo-Json -Compress
  Set-Content -LiteralPath $tmpJson -Value $defaultJson -NoNewline -Encoding UTF8
}

Ok "Payload at $tmpJson : $(Get-Content -LiteralPath $tmpJson -Raw)"

# 7) Publish via nats-box (be careful to keep $MSG literal inside sh)
Info "Publishing to '$Subject' via nats-box..."
$shCmd = 'MSG=$(cat /tmp/payload.json); ' + "nats --server nats://nats:4222 pub '$Subject' " + '"$MSG"'

$publishCmd = @(
  'docker','run','--rm','--network', $net,
  '-v', "${tmpJson}:/tmp/payload.json:ro",
  'synadia/nats-box:latest','sh','-lc', $shCmd
)
$rcPub = TryRun $publishCmd
if ($rcPub -ne 0) {
  Warn "Publish exited with code $rcPub. Check subject name or payload."
} else {
  Ok "Publish completed."
}

# 8) Show recent logs
Info "Recent logs (last $LogTailLines lines) from normalizer & tax-engine:"
TryRun @('docker','compose','logs','--tail',"$LogTailLines",'normalizer','tax-engine')

if ($LogFollowSeconds -gt 0) {
  Info "Following logs for $LogFollowSeconds seconds..."
  $p = Start-Process -FilePath 'docker' -ArgumentList @('compose','logs','-f','normalizer','tax-engine') -NoNewWindow -PassThru
  Start-Sleep -Seconds $LogFollowSeconds
  try { $p | Stop-Process -Force } catch {}
}

Ok "Phase 4 smoke finished."
