<#  tools/repair_repo.ps1  — portable, no parameter sets, no Split-Path
    - Ensures event-normalizer Dockerfile has required Python deps
    - Removes obsolete `version:` from docker-compose.yml
    - Writes docker-compose.override.yml to publish normalizer on host :8000 and :8001
    - Rebuilds & restarts normalizer
    - Verifies health endpoints

    Run:
      powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\repair_repo.ps1
#>

param(
  [int]$ContainerPort = 8001,           # Container port normalizer binds to
  [int[]]$PublishPorts = @(8000,8001),  # Host ports -> container port
  [int]$HealthTimeoutSec = 10
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info  ($m){ Write-Host "[ INFO ] $m" -ForegroundColor Cyan }
function Write-Ok    ($m){ Write-Host "[ OK ]  $m" -ForegroundColor Green }
function Write-Warn  ($m){ Write-Host "[ WARN ] $m" -ForegroundColor Yellow }
function Write-Err   ($m){ Write-Host "[ ERR ] $m" -ForegroundColor Red }

# --- Robust script/repo paths (no Split-Path) ---
# Prefer $PSScriptRoot when available (v3+), otherwise use $MyInvocation
if ($PSScriptRoot) {
  $ScriptDir = $PSScriptRoot
} elseif ($MyInvocation -and $MyInvocation.MyCommand -and $MyInvocation.MyCommand.Path) {
  $ScriptDir = [System.IO.Path]::GetDirectoryName($MyInvocation.MyCommand.Path)
} else {
  # Fallback to current location if all else fails
  $ScriptDir = (Get-Location).Path
}

# Repo root assumed one level up from /tools
$RepoRoot = [System.IO.Directory]::GetParent($ScriptDir).FullName
Write-Info "Repo root: $RepoRoot"

# Paths
$NormDockerfile = Join-Path $RepoRoot 'apps/services/event-normalizer/Dockerfile'
$ComposePath    = Join-Path $RepoRoot 'docker-compose.yml'
$OverridePath   = Join-Path $RepoRoot 'docker-compose.override.yml'

# Helpers
function Backup-File([string]$Path){
  if (-not (Test-Path $Path)) { return $false }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $bak   = "$Path.$stamp.bak"
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Write-Ok "Backed up: $Path -> $bak"
  return $true
}

function Replace-InFile([string]$Path, [scriptblock]$Transform){
  if (-not (Test-Path $Path)) { throw "Missing file: $Path" }
  $text    = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  $updated = & $Transform $text
  if ($updated -ne $null -and $updated -ne $text) {
    Set-Content -LiteralPath $Path -Value $updated -Encoding UTF8
    return $true
  }
  return $false
}

# 1) Ensure normalizer Dockerfile has required deps
$RequiredPy = @('fastapi','uvicorn[standard]','pydantic','orjson','nats-py','prometheus-client','httpx')

if (Test-Path $NormDockerfile) {
  Backup-File $NormDockerfile | Out-Null

  $added = Replace-InFile $NormDockerfile {
    param($t)
    $hasAll = $true
    foreach ($pkg in $RequiredPy) {
      if ($t -notmatch [regex]::Escape($pkg)) { $hasAll = $false; break }
    }
    if ($hasAll) { return $t }

    $lines = $t -split "`r?`n"
    $installLine = "RUN pip install --no-cache-dir " + ($RequiredPy -join ' ')
    $lastRun = ($lines | Select-String -Pattern '^\s*RUN\s+pip\s+install' | Select-Object -Last 1)

    if (-not $lastRun) {
      $final = ($lines | Select-String -Pattern '^\s*(CMD|ENTRYPOINT)\b' | Select-Object -First 1)
      if ($final) {
        $idx = $final.LineNumber - 1
        $before = $lines[0..($idx-1)]
        $after  = $lines[$idx..($lines.Length-1)]
        return ($before + $installLine + $after) -join "`r`n"
      } else {
        return ($lines + $installLine) -join "`r`n"
      }
    } else {
      $insertAt = $lastRun.LineNumber
      $before = $lines[0..($insertAt-1)]
      $after  = $lines[$insertAt..($lines.Length-1)]
      return ($before + $installLine + $after) -join "`r`n"
    }
  }

  if ($added) {
    Write-Ok  "Ensured packages in normalizer Dockerfile: $($RequiredPy -join ', ')"
  } else {
    Write-Ok  "Normalizer Dockerfile already had required packages"
  }
} else {
  Write-Warn "Normalizer Dockerfile not found at: $NormDockerfile (skipping dep ensure)"
}

# 2) Remove obsolete 'version:' key from docker-compose.yml
if (Test-Path $ComposePath) {
  Backup-File $ComposePath | Out-Null
  $removed = Replace-InFile $ComposePath {
    param($t)
    # remove lines like: version: "3.9" or version: '3.8' or version: 3.8
    $t2 = ($t -split "`r?`n" | Where-Object {
      $_ -notmatch '^\s*version\s*:\s*(".*?"|''.*?''|[0-9\.]+)\s*$'
    }) -join "`r`n"
    return $t2
  }
  if ($removed) {
    Write-Ok "Removed obsolete 'version:' key from docker-compose.yml"
  } else {
    Write-Ok "No 'version:' key found (already clean)"
  }
} else {
  Write-Warn "docker-compose.yml not found at: $ComposePath"
}

# 3) docker-compose.override.yml to expose ports and set PORT env
if (Test-Path $OverridePath) { Backup-File $OverridePath | Out-Null }

$yaml = New-Object System.Collections.Generic.List[string]
$yaml.Add('services:')
$yaml.Add('  normalizer:')
$yaml.Add('    environment:')
$yaml.Add(("      - PORT={0}" -f $ContainerPort))
$yaml.Add('    ports:')
foreach ($hp in $PublishPorts) {
  $yaml.Add(('      - "{0}:{1}"' -f $hp, $ContainerPort))
}

Set-Content -LiteralPath $OverridePath -Value ($yaml -join "`r`n") -Encoding UTF8
Write-Ok "Wrote docker-compose.override.yml to expose normalizer on :$($PublishPorts -join ', :') -> :$ContainerPort"

# 4) Docker helper
function Invoke-Docker {
  param([string[]]$CmdArgs)
  Write-Info ("docker compose {0}" -f ($CmdArgs -join ' '))
  & docker compose @CmdArgs
}

# 5) Rebuild & restart normalizer
Write-Info "Rebuilding normalizer (no cache)..."
Invoke-Docker -CmdArgs @('build','--no-cache','normalizer') | Out-Null
Write-Ok "Build completed"

Write-Info "Starting normalizer..."
Invoke-Docker -CmdArgs @('up','-d','--force-recreate','--no-deps','normalizer') | Out-Null
Write-Ok "Compose up completed"

# 6) Show current services & mapped ports
Write-Info "Current services:"
Invoke-Docker -CmdArgs @('ps') | Out-Null

foreach ($hp in $PublishPorts) {
  try {
    $mapped = (& docker compose port normalizer $hp) 2>$null
    if ($mapped) { Write-Ok ("docker compose port normalizer {0} => {1}" -f $hp,$mapped.Trim()) }
  } catch { }
}

# 7) Health probes (host)
function Test-Health([string]$Url, [int]$TimeoutSec){
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $Url
      if ($resp.StatusCode -eq 200) { return $resp.Content }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  return $null
}

foreach ($hp in $PublishPorts) {
  $u = "http://127.0.0.1:$hp/healthz"
  Write-Info "Probing $u ..."
  $ok = Test-Health -Url $u -TimeoutSec $HealthTimeoutSec
  if ($ok) { Write-Ok "Health OK on $u : $ok" } else { Write-Warn "Health probe did not return 200 within ${HealthTimeoutSec}s for $u" }
}

# 8) Show published ports via inspect
try {
  $cid = (& docker compose ps -q normalizer).Trim()
  if ($cid) {
    $portsJson = & docker inspect $cid --format '{{json .NetworkSettings.Ports}}'
    Write-Info "Published ports (docker inspect):"
    Write-Host $portsJson
  }
} catch { }

# 9) In-container quick probe (silent, optional)
try {
  Write-Info "In-container check:"
  & docker compose exec -T normalizer sh -lc "command -v curl >/dev/null 2>&1 || (apk add --no-cache curl >/dev/null 2>&1 || (apt-get update >/dev/null 2>&1 && apt-get install -y curl >/dev/null 2>&1)); curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:${ContainerPort}/healthz"
} catch { }

Write-Ok "Repo repair complete."
