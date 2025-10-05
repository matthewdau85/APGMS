<#  tools/check_all_phases.ps1

    Usage:
      powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\check_all_phases.ps1
      powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\check_all_phases.ps1 -Subject 'apgms.tx.calculate'
      powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\check_all_phases.ps1 -SkipPhase4

#>

[CmdletBinding()]
param(
  [string]$Subject = 'apgms.tx.calculate',
  [switch]$SkipPhase4
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Info([string]$msg){ Write-Host "[ INFO ] $msg" -ForegroundColor Cyan }
function Ok  ([string]$msg){ Write-Host "[ OK ]  $msg" -ForegroundColor Green }
function Warn([string]$msg){ Write-Host "[ WARN ] $msg" -ForegroundColor Yellow }
function Err ([string]$msg){ Write-Host "[ ERR ]  $msg" -ForegroundColor Red }

function Invoke-InRepo([scriptblock]$Block, [string]$Path){
  Push-Location $Path
  try   { & $Block }
  finally { Pop-Location }
}

function Test-Endpoint {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Url,
    [int]$TimeoutSec = 15
  )
  Info ("Probing {0}: {1}" -f $Name, $Url)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers @{ 'Connection'='close' } -TimeoutSec 5
      if ($resp.StatusCode -eq 200) {
        Ok ("{0} healthy (HTTP 200)" -f $Name)
        return $true
      }
    } catch { Start-Sleep -Milliseconds 400 }
  } while((Get-Date) -lt $deadline)
  Warn ("{0} did not return 200 within {1} s" -f $Name, $TimeoutSec)
  return $false
}

function Get-ComposeProjectRoot {
  # Prefer PowerShell’s built-ins; fall back safely
  if ($PSScriptRoot) { return (Split-Path -LiteralPath $PSScriptRoot -Parent) }

  if ($PSCommandPath) {
    $here = Split-Path -LiteralPath $PSCommandPath -Parent
    return (Split-Path -LiteralPath $here -Parent)
  }

  if ($MyInvocation -and $MyInvocation.MyCommand) {
    $def = $MyInvocation.MyCommand.Definition
    if ($def) {
      $here = Split-Path -LiteralPath $def -Parent
      return (Split-Path -LiteralPath $here -Parent)
    }
  }

  # Worst-case fallback: assume script lives in tools\ under repo root
  $cwd = Get-Location
  return (Split-Path -LiteralPath $cwd.Path -Parent)
}

# ---------- MAIN ----------
$RepoRoot = Get-ComposeProjectRoot
Info ("Repo root: {0}" -f $RepoRoot)

$ComposePath = Join-Path $RepoRoot 'docker-compose.yml'
if (!(Test-Path $ComposePath)) { Err ("Missing {0}" -f $ComposePath); exit 1 }

# ---- Phase 1: docker-compose sanity (no 'version:' key) ----
$composeText = Get-Content -LiteralPath $ComposePath -Raw -Encoding UTF8
$hasVersionLine = $false
foreach($line in ($composeText -split "`r?`n")){
  if ($line -match "^\s*version\s*:\s*("".*?""|'.*?'|[0-9\.]+)\s*$"){
    $hasVersionLine = $true; break
  }
}
if ($hasVersionLine){
  Warn "docker-compose.yml still contains an obsolete 'version:' key."
}else{
  Ok "Phase 1: docker-compose.yml looks clean (no 'version:' key)."
}

# ---- Phase 2: normalizer Dockerfile contains required deps ----
$DockerfilePath = Join-Path $RepoRoot 'apps\services\event-normalizer\Dockerfile'
$requiredPkgs = @('fastapi','uvicorn\[standard\]','pydantic','orjson','nats-py','prometheus-client','httpx')
if (!(Test-Path $DockerfilePath)){
  Warn ("Phase 2: Normalizer Dockerfile not found at {0}" -f $DockerfilePath)
}else{
  $dock = Get-Content -LiteralPath $DockerfilePath -Raw -Encoding UTF8
  $missing = @()
  foreach($rx in $requiredPkgs){
    if ($dock -notmatch $rx){ $missing += $rx }
  }
  if ($missing.Count -gt 0){
    Warn ("Phase 2: Dockerfile may be missing: {0}" -f ($missing -join ', '))
  }else{
    Ok "Phase 2: Normalizer Dockerfile includes all expected packages."
  }
}

# ---- Phase 3: services up and healthy ----
Invoke-InRepo { & docker compose up -d nats normalizer tax-engine | Out-Null } $RepoRoot
Ok "Compose services ensured running (nats, normalizer, tax-engine)."

$okNats  = Test-Endpoint -Name 'NATS monitoring' -Url 'http://127.0.0.1:8222/healthz'
$okNorm  = Test-Endpoint -Name 'normalizer'      -Url 'http://127.0.0.1:8001/healthz'
$okTax   = Test-Endpoint -Name 'tax-engine'      -Url 'http://127.0.0.1:8002/healthz'

# Show published ports
$cidNorm = $null
Invoke-InRepo {
  $id = (& docker compose ps -q normalizer)
  if ($id){ $script:cidNorm = $id.Trim() }
} $RepoRoot

if ($cidNorm){
  Info 'Published ports (normalizer docker inspect):'
  docker inspect $cidNorm --format '{{json .NetworkSettings.Ports}}' | Write-Host
  Info 'In-container health check (normalizer):'
  Invoke-InRepo {
    & docker compose exec normalizer sh -lc 'apk add --no-cache curl >/dev/null 2>&1 || :; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8001/healthz'
  } $RepoRoot
}

if ($okNats -and $okNorm -and $okTax){
  Ok 'Phase 3: all health checks passed.'
}else{
  Warn 'Phase 3: one or more health checks failed; logs may help:'
  Info '  docker compose logs -f nats normalizer tax-engine'
}

# ---- Phase 4: optional NATS publish smoke (uses synadia/nats-box) ----
if ($SkipPhase4){
  Warn 'Phase 4 skipped (requested).'
  exit 0
}

# Find compose network name from NATS container
$cidNats = $null
Invoke-InRepo {
  $id = (& docker compose ps -q nats)
  if ($id){ $script:cidNats = $id.Trim() }
} $RepoRoot

if (-not $cidNats){
  Warn 'Phase 4: could not find NATS container id; skipping publish smoke.'
  exit 0
}

$inspect = docker inspect $cidNats | ConvertFrom-Json
$netName = ($inspect[0].NetworkSettings.Networks.PSObject.Properties.Name | Select-Object -First 1)
if (-not $netName){
  Warn 'Phase 4: could not resolve compose network; skipping publish smoke.'
  exit 0
}

$payload     = '{"ping":"ok"}'
$payloadB64  = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))

Info ("Phase 4: publishing a test message to subject: {0}" -f $Subject)
$runArgs = @(
  'run','--rm',
  '--network', $netName,
  '-e', "SUBJECT=$Subject",
  '-e', "PAYLOAD_B64=$payloadB64",
  'synadia/nats-box:latest',
  'sh','-lc',
  'MSG=$(echo "$PAYLOAD_B64" | base64 -d); nats --server nats://nats:4222 pub "$SUBJECT" "$MSG"'
)

try{
  & docker @runArgs | Write-Host
  Ok 'Phase 4: publish attempted (check tax-engine logs for processing).'
  Info ('Tip: docker compose logs --since=2m tax-engine')
}catch{
  Warn ("Phase 4: publish failed: {0}" -f $_.Exception.Message)
  Info 'You may need internet access to pull synadia/nats-box the first time.'
}

# ---- Summary ----
if ($hasVersionLine){
  Warn "Summary: Phase 1 needs attention (remove 'version:' from docker-compose.yml)."
}
if (-not $okNats -or -not $okNorm -or -not $okTax){
  Warn 'Summary: Phase 3 had health check warnings.'
}else{
  Ok 'Summary: Phases 1–3 look good.'
}
Ok 'Done.'
