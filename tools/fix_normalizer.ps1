<# tools\fix_normalizer.ps1 #>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Resolve repo root (parent of this script's folder) ---
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir '..')

Write-Host "[ INFO ] Repo root: $RepoRoot"

# --- Paths ---
$Compose         = Join-Path $RepoRoot 'docker-compose.yml'
$ComposeOverride = Join-Path $RepoRoot 'docker-compose.override.yml'
$NormDockerfile  = Join-Path $RepoRoot 'apps/services/event-normalizer/Dockerfile'
$NormRunner      = Join-Path $RepoRoot 'apps/services/event-normalizer/run_normalizer.py'

function Backup-File($Path) {
  if (Test-Path $Path) {
    $bak = "$Path.$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
    Copy-Item $Path $bak -Force
    Write-Host "[ OK ] Backed up: $Path -> $bak"
  }
}

# --- Sanity checks ---
$missing = @()
foreach ($p in @($Compose, $NormDockerfile, $NormRunner)) {
  if (-not (Test-Path $p)) { $missing += $p }
}
if ($missing.Count -gt 0) {
  $missing | ForEach-Object { Write-Host "[ ERR ] Missing expected file: $_" -ForegroundColor Red }
  throw "Cannot continue due to missing files."
}

# --- 1) Ensure runtime deps in the normalizer image ---
Backup-File $NormDockerfile
$dockerTxt = Get-Content $NormDockerfile -Raw

function Test-PipHasPackage([string]$text, [string]$pkg) {
  return ($text -match "(?im)^\s*RUN\s+pip\s+install[^\r\n]*\b$([regex]::Escape($pkg))\b")
}

$requiredPkgs = @('orjson','nats-py','prometheus-client','httpx')
$pkgsToAdd = @()
foreach ($pkg in $requiredPkgs) {
  if (-not (Test-PipHasPackage $dockerTxt $pkg)) { $pkgsToAdd += $pkg }
}

if ($pkgsToAdd.Count -gt 0) {
  # Insert a new RUN line right after the first pip install, or append if none exist
  $rx = [regex]'(?im)^\s*RUN\s+pip\s+install[^\r\n]*$'
  $m  = $rx.Match($dockerTxt)
  $lineToInsert = "RUN pip install --no-cache-dir " + ($pkgsToAdd -join ' ')
  if ($m.Success) {
    $insertAt = $m.Index + $m.Length
    $dockerTxt = $dockerTxt.Insert($insertAt, "`r`n$lineToInsert")
  } else {
    $dockerTxt = $dockerTxt.TrimEnd() + "`r`n$lineToInsert`r`n"
  }
  Set-Content $NormDockerfile -Value $dockerTxt -Encoding UTF8
  Write-Host "[ OK ] Ensured packages in normalizer Dockerfile: $($pkgsToAdd -join ', ')"
} else {
  Write-Host "[ OK ] All required packages already present in normalizer Dockerfile"
}

# --- 2) Detect the normalizer service port (fallback to 8000) ---
$runner = Get-Content $NormRunner -Raw
[int]$port = 0

$envPort = [regex]::Match($runner, 'PORT\s*=\s*int\(\s*os\.getenv\(\s*["'']PORT["'']\s*,\s*["''](?<p>\d{2,5})["'']\s*\)\s*\)')
if ($envPort.Success) { $port = [int]$envPort.Groups['p'].Value }

if (-not $port) {
  $runPort = [regex]::Match($runner, 'uvicorn\.run\([^)]*?port\s*=\s*(?<p>\d{2,5})')
  if ($runPort.Success) { $port = [int]$runPort.Groups['p'].Value }
}

if (-not $port) {
  $port = 8000
  Write-Host "[ WARN ] Could not detect port from code; defaulting to $port"
} else {
  Write-Host "[ OK ] Detected normalizer internal port: $port"
}

# --- 3) Remove obsolete 'version:' from docker-compose.yml (silence Compose warning) ---
Backup-File $Compose
$composeTxt = Get-Content $Compose -Raw
if ($composeTxt -match '(?m)^\s*version\s*:\s*.*$') {
  $composeTxt = ($composeTxt -split "`r?`n" | Where-Object { $_ -notmatch '^\s*version\s*:\s*.*$' }) -join "`r`n"
  Set-Content $Compose -Value $composeTxt -Encoding UTF8
  Write-Host "[ OK ] Removed obsolete 'version:' from docker-compose.yml"
} else {
  Write-Host "[ OK ] No 'version:' key found (already clean)"
}

# --- 4) docker-compose.override.yml to publish the normalizer port ---
Backup-File $ComposeOverride
$overrideYaml = @'
services:
  normalizer:
    ports:
      - "__PORT__:__PORT__"
'@.Trim() + "`r`n"
$overrideYaml = $overrideYaml.Replace('__PORT__', "$port")
Set-Content $ComposeOverride -Value $overrideYaml -Encoding UTF8
Write-Host "[ OK ] Wrote docker-compose.override.yml to expose normalizer on $port"

# --- 5) Rebuild & restart ONLY normalizer (no cache) ---
Push-Location $RepoRoot
Write-Host "[ INFO ] Rebuilding normalizer (no cache)..."
docker compose build --no-cache normalizer

Write-Host "[ INFO ] Starting normalizer..."
docker compose up -d normalizer

Write-Host "[ INFO ] Current services:"
docker compose ps

# --- 6) Tail logs (short burst), then poll /healthz up to ~30s ---
Write-Host "[ INFO ] Recent normalizer logs (last 120 lines):"
docker compose logs --tail=120 normalizer

$healthUrl = "http://localhost:$port/healthz"
Write-Host "[ INFO ] Probing $healthUrl ..."
$ok = $false
for ($i=1; $i -le 15; $i++) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $healthUrl
    Write-Host "[ OK ] /healthz -> $($resp.StatusCode) $($resp.StatusDescription)"
    if ($resp.Content) { Write-Host $resp.Content }
    $ok = $true
    break
  } catch {
    Start-Sleep -Milliseconds 2000
  }
}

if (-not $ok) {
  Write-Warning "Health probe failed after multiple attempts."
  Write-Host "[ INFO ] Showing last 5 minutes of logs for 'normalizer' (up to 300 lines):"
  docker compose logs --since=5m --tail=300 normalizer
  Write-Host "Tip:   docker compose logs -f normalizer"
}

Pop-Location
