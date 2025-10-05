# tools\fix_compose.ps1
param(
  [string]$ComposePath = (Join-Path (Resolve-Path ".").Path "docker-compose.yml")
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $ComposePath)) {
  Write-Error "docker-compose.yml not found at $ComposePath"
  exit 1
}

# Backup first
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $ComposePath "$ComposePath.$ts.bak" -Force
Write-Host "[ OK ] Backed up: $ComposePath -> $ComposePath.$ts.bak"

# Read all lines
$lines = Get-Content $ComposePath

# State
$inNormalizer = $false
$normalizerIndent = ""
$inEnv = $false
$envIndent = ""
$envSet = @{}
$normalizerBody = New-Object System.Collections.Generic.List[string]
$out = New-Object System.Collections.Generic.List[string]

function Flush-Normalizer {
  param(
    [System.Collections.Generic.List[string]]$Body,
    [hashtable]$EnvSet,
    [string]$Indent
  )
  # Ensure required env vars
  if (-not $EnvSet.ContainsKey("APP_MODULE")) { $EnvSet["APP_MODULE"] = "app.main:app" }
  if (-not $EnvSet.ContainsKey("UVICORN_PORT")) { $EnvSet["UVICORN_PORT"] = "8001" }

  # Reconstruct the block: body first, then a single environment section
  foreach ($b in $Body) { $out.Add($b) }

  # Write environment block once, using indent + 2 spaces
  $envKeyIndent = "$Indent  "
  $envItemIndent = "$Indent    "
  $out.Add("$envKeyIndent" + "environment:")
  foreach ($k in ($EnvSet.Keys | Sort-Object)) {
    $out.Add("$envItemIndent- $k=$($EnvSet[$k])")
  }
}

# Helper: is this a top-level-ish service key line? (same indent as normalizer)
function Is-ServiceKeyLine {
  param([string]$Line)
  return ($Line -match '^\s{2,}[A-Za-z0-9._-]+:\s*$') -and (-not ($Line -match '^\s+environment:\s*$'))
}

for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]

  if (-not $inNormalizer) {
    $out.Add($line)
    if ($line -match '^\s*normalizer:\s*$' -or $line -match '^\s{2,}normalizer:\s*$') {
      $inNormalizer = $true
      $normalizerIndent = ($line -match '^(\s*)')[1]
      $normalizerBody.Clear()
      $envSet.Clear()
      $inEnv = $false
      $envIndent = ""
    }
    continue
  }

  # We're inside the normalizer block
  # Detect leaving the block: next service key at same or less indent
  if (Is-ServiceKeyLine $line) {
    # We're about to leave the normalizer block -> flush it, then add this line and continue outside
    Flush-Normalizer -Body $normalizerBody -EnvSet $envSet -Indent $normalizerIndent
    $out.Add($line)
    $inNormalizer = $false
    continue
  }

  # Handle environment sections (merge all of them)
  if ($inEnv) {
    if ($line -match '^\s*-\s*([A-Z0-9_]+)=(.*)\s*$') {
      $k = $matches[1]; $v = $matches[2]
      $envSet[$k] = $v
      continue
    }
    # leaving the env sub-list if indentation drops or line no longer looks like a list item
    if (-not ($line -match '^\s*-\s')) {
      $inEnv = $false
      # fall-through to regular handling
    } else {
      continue
    }
  }

  if ($line -match '^\s*environment:\s*$') {
    # Start/merge env; don't add this key line now, we reconstruct later
    $inEnv = $true
    $envIndent = ($line -match '^(\s*)')[1]
    continue
  }

  # Normal line inside normalizer (but not environment)
  $normalizerBody.Add($line)
}

# If file ended while still inside normalizer, flush it
if ($inNormalizer) {
  Flush-Normalizer -Body $normalizerBody -EnvSet $envSet -Indent $normalizerIndent
}

# Write back
$out | Set-Content -Encoding UTF8 $ComposePath
Write-Host "[ OK ] Merged duplicate environment blocks under 'normalizer' and ensured APP_MODULE/UVICORN_PORT."
