# fix_gui_target.ps1
$ErrorActionPreference = 'Stop'

# --- 1) Pick main compose at repo root ---
$main = if (Test-Path 'docker-compose.yml') { 'docker-compose.yml' }
elseif (Test-Path 'docker-compose.yaml') { 'docker-compose.yaml' }
else { throw "No docker-compose.yml or .yaml found at repo root." }

# --- 2) Render merged config ---
$cfgText = (& docker compose -f $main config) 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Failed to run 'docker compose config' on $main.`n$($cfgText | Out-String)"
}

# --- 3) Parse only inside services: find service that exposes port 8001 ---
$lines = $cfgText -split "`r?`n"

$inServices = $false
$currentService = $null
$inPorts = $false
$target = $null

foreach ($ln in $lines) {
  if ($ln -match '^services:\s*$') { $inServices = $true; $currentService = $null; $inPorts = $false; continue }
  if ($inServices -and $ln -match '^[^\s].*:$') { break }  # top-level key -> leave services

  if ($inServices) {
    $m = [regex]::Match($ln, '^\s{2}([A-Za-z0-9._-]+):\s*$')
    if ($m.Success) { $currentService = $m.Groups[1].Value; $inPorts = $false; continue }

    if ($currentService) {
      if ($ln -match '^\s{4}ports:\s*$') { $inPorts = $true; continue }
      if ($inPorts) {
        if ($ln -match '^\s{6}-\s*.*8001') { $target = $currentService; break }
        if ($ln -match '^\s{4}[A-Za-z0-9._-]+:\s*$') { $inPorts = $false } # end ports block
      }
    }
  }
}

if (-not $target) {
  if ($cfgText -match '^\s{2}(normalizer):\s*$') { $target = 'normalizer' }
  else { throw "Could not auto-detect a service exposing port 8001 in $main. Tell me the correct service name." }
}

Write-Host "Detected service for port 8001: $target"

# --- 4) Patch docker-compose.gui.yaml: ensure depends_on list under gui: ---
$guiFile = 'docker-compose.gui.yaml'
if (-not (Test-Path $guiFile)) { throw "$guiFile not found at repo root." }

# helper: get leading space count
function Get-Indent([string]$s) { ($s -replace '(^\s*).*$','$1').Length }

# read lines as a mutable List[string]
$guiArray = New-Object 'System.Collections.Generic.List[string]'
(Get-Content $guiFile) | ForEach-Object { [void]$guiArray.Add($_) }

# find 'gui:' line index manually
$guiIdx = -1
for ($i=0; $i -lt $guiArray.Count; $i++) {
  if ($guiArray[$i] -match '^\s*gui:\s*$') { $guiIdx = $i; break }
}
if ($guiIdx -lt 0) { throw "'gui:' service not found in $guiFile." }

$guiIndent   = Get-Indent $guiArray[$guiIdx]
$childIndent = $guiIndent + 2
$depHeaderRegex = "^\s{$childIndent}depends_on:\s*$"

# compute end of gui block to know where to insert
$endOfGui = $guiArray.Count
for ($i = $guiIdx + 1; $i -lt $guiArray.Count; $i++) {
  $ind = Get-Indent $guiArray[$i]
  if ($ind -le $guiIndent -and $guiArray[$i].Trim().EndsWith(':')) { $endOfGui = $i; break }
}

# locate depends_on (if exists) directly under gui:
$depStart = -1
for ($i = $guiIdx + 1; $i -lt $endOfGui; $i++) {
  if ($guiArray[$i] -match $depHeaderRegex) { $depStart = $i; break }
}

if ($depStart -lt 0) {
  # insert fresh depends_on at the end of the gui block (before endOfGui)
  $toInsert = @(
    (' ' * $childIndent)     + 'depends_on:'
    (' ' * ($childIndent+2)) + "- $target"
  )
  $insertPos = $endOfGui
  for ($k = $toInsert.Length - 1; $k -ge 0; $k--) {
    $guiArray.Insert($insertPos, $toInsert[$k])
  }
} else {
  # normalize the list under depends_on to only our target
  # remove existing "- ..." list items directly under depends_on
  $j = $depStart + 1
  while ($j -lt $endOfGui -and $guiArray[$j] -match "^\s{$($childIndent+2)}-\s") {
    $guiArray.RemoveAt($j) | Out-Null
    $endOfGui--  # list shrank
  }
  # insert our single item
  $guiArray.Insert($depStart + 1, (' ' * ($childIndent+2)) + "- $target")
}

Set-Content -LiteralPath $guiFile -Value $guiArray -Encoding UTF8
Write-Host ("Updated {0}: depends_on -> {1} (under gui:)" -f $guiFile, $target)

# --- 5) Patch Nginx upstream in ops/nginx.gui.conf ---
$nginxConf = 'ops/nginx.gui.conf'
if (-not (Test-Path $nginxConf)) { throw "$nginxConf not found (expected server block file)." }
$ngRaw = Get-Content $nginxConf -Raw
$ngNew = $ngRaw
$ngNew = $ngNew -replace 'proxy_pass\s+http://[^:;/]+:8001/;', "proxy_pass http://$target:8001/;"
$ngNew = $ngNew -replace 'proxy_pass\s+http://[^;]+;',        "proxy_pass http://$target:8001/;"

if ($ngNew -eq $ngRaw) {
  # insert inside location /api/ { ... } if proxy_pass missing
  $ngNew = [regex]::Replace($ngRaw,
    '(?ms)(location\s+/api/\s*\{)',
    "`$1`r`n    proxy_pass http://$target:8001/;")
}

Set-Content -LiteralPath $nginxConf -Value $ngNew -Encoding UTF8
Write-Host "Updated $nginxConf proxy_pass -> http://$target:8001/"

# --- 6) Recreate GUI & show status ---
docker compose -f $main -f $guiFile up -d --force-recreate gui | Out-Null
Start-Sleep -Seconds 2

Write-Host "`n-- GUI mounts --"
docker inspect apgms-final-gui-1 --format '{{json .Mounts}}' | Write-Host

Write-Host "`n-- GUI logs (tail) --"
docker compose -f $main -f $guiFile logs --tail=40 gui
