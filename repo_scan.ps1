# fix_gui_target.ps1
$ErrorActionPreference = 'Stop'

# 1) Pick main compose at repo root
$main = if (Test-Path 'docker-compose.yml') { 'docker-compose.yml' }
elseif (Test-Path 'docker-compose.yaml') { 'docker-compose.yaml' }
else { throw "No docker-compose.yml or .yaml found at repo root." }

# 2) Render merged config text (so we can parse service + ports)
$cfgText = (& docker compose -f $main config) 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Failed to run 'docker compose config' on $main.`n$($cfgText | Out-String)"
}

# 3) Heuristically find the service that publishes port 8001
#    We walk the rendered config and remember the most recent top-level service header (e.g. 'api:')
#    When we enter a 'ports:' block and see a line mentioning 8001, we accept that service.
$lines = $cfgText -split "`r?`n"
$currentService = $null
$inServiceBlock = $false
$inPorts = $false
$target = $null

foreach ($ln in $lines) {
  # Top-level service headers look like: "api:" (no leading spaces)
  if ($ln -match '^[A-Za-z0-9._-]+:\s*$') {
    $currentService = $ln.TrimEnd(':').Trim()
    $inServiceBlock = $true
    $inPorts = $false
    continue
  }

  # Leaving a service block (another top-level key like "networks:", "volumes:", etc.)
  if ($ln -match '^[A-Za-z0-9._-]+:\s+\S' -and $currentService) {
    $inServiceBlock = $false
    $inPorts = $false
  }

  if ($inServiceBlock) {
    if ($ln -match '^\s+ports:\s*$') {
      $inPorts = $true
      continue
    }
    if ($inPorts) {
      # Typical forms include " - 0.0.0.0:8001->8001/tcp" or " - 8001:8001"
      if ($ln -match '8001') {
        $target = $currentService
        break
      }
      # End ports block on dedent or new section
      if ($ln -match '^\s{0,2}[A-Za-z0-9._-]+:\s*$') { $inPorts = $false }
    }
  }
}

if (-not $target) {
  # Fallback: maybe service is literally named 'normalizer'
  if ($cfgText -match '^(normalizer):\s*$') { $target = 'normalizer' }
  else {
    throw "Could not auto-detect a service exposing port 8001 in $main. Please tell me the correct service name."
  }
}

Write-Host "Detected service for port 8001: $target"

# 4) Patch docker-compose.gui.yaml 'depends_on' to point to the detected service
$guiFile = 'docker-compose.gui.yaml'
if (-not (Test-Path $guiFile)) { throw "$guiFile not found at repo root." }
$guiRaw = Get-Content $guiFile -Raw

# Replace any depends_on block with our target (keeps indentation)
# - If a depends_on line exists, normalize it to a single item with our target.
# - If not present, insert it under 'gui:' (simple heuristic).
if ($guiRaw -match '(?ms)^\s*depends_on:\s*(\r?\n\s*-\s*.+)+') {
  $guiRaw = [regex]::Replace($guiRaw, '(?ms)^\s*depends_on:\s*(\r?\n\s*-\s*.+)+', "  depends_on:`r`n    - $target")
} else {
  # Insert after 'gui:' if possible
  $guiRaw = [regex]::Replace($guiRaw, '(?m)^(  gui:\s*$)', "`$1`r`n    depends_on:`r`n      - $target")
}

Set-Content -LiteralPath $guiFile -Value $guiRaw -Encoding UTF8
Write-Host "Updated $guiFile depends_on -> $target"

# 5) Patch Nginx upstream in ops/nginx.gui.conf
$nginxConf = 'ops/nginx.gui.conf'
if (-not (Test-Path $nginxConf)) { throw "$nginxConf not found (expected server block file)." }
$ngRaw = Get-Content $nginxConf -Raw
$ngRaw = $ngRaw -replace 'proxy_pass http://[^:]+:8001/;', "proxy_pass http://$target:8001/;"
Set-Content -LiteralPath $nginxConf -Value $ngRaw -Encoding UTF8
Write-Host "Updated $nginxConf proxy_pass -> http://$target:8001/"

# 6) Recreate GUI
docker compose -f $main -f $guiFile up -d --force-recreate gui | Out-Null
Start-Sleep -Seconds 2

# 7) Show mounts and a short log tail for confirmation
Write-Host "`n-- GUI mounts --"
docker inspect apgms-final-gui-1 --format '{{json .Mounts}}' | Write-Host

Write-Host "`n-- GUI logs (tail) --"
docker compose -f $main -f $guiFile logs --tail=40 gui
