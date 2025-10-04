# Fix-Normalizer-Metrics.ps1
[CmdletBinding()]
param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"
function OK($m){ Write-Host "OK: $m" -ForegroundColor Green }
function INFO($m){ Write-Host "INFO: $m" -ForegroundColor Gray }

$normMain = Join-Path $RepoRoot "apps/services/event-normalizer/app/main.py"
if(!(Test-Path $normMain)){ throw "Missing $normMain" }

# 1) Read as lines so we can surgically remove the bad region
$lines = Get-Content -LiteralPath $normMain

# 2) Build new content skipping:
#    - any line that contains NORMALIZER_TAX_RESULTS
#    - any immediately following "continuation/garbage" lines that start with backslashes
$new = New-Object System.Collections.Generic.List[string]
$skipGarbage = $false
foreach($ln in $lines){
  if($skipGarbage){
    if($ln -match '^\s*\\'){ continue } else { $skipGarbage = $false }
  }
  if($ln -match 'NORMALIZER_TAX_RESULTS'){
    $skipGarbage = $true
    continue
  }
  $new.Add($ln)
}

# 3) Ensure prometheus Counter import exists
if(-not ($new -match '^\s*from\s+prometheus_client\s+import\s+Counter')){
  # Insert after the first block of imports
  $idx = ($new | Select-String -Pattern '^\s*import\s+|^\s*from\s+').Count
  if($idx -eq 0){ $new.Insert(0,'from prometheus_client import Counter') }
  else { $new.Insert($idx, 'from prometheus_client import Counter') }
}

# 4) Insert a clean, idempotent guarded metric definition right after the Counter import
$guard = @'
# Guarded metric registration (prevents double-register on reload)
try:
    NORMALIZER_TAX_RESULTS  # type: ignore[name-defined]
except NameError:
    NORMALIZER_TAX_RESULTS = Counter("normalizer_tax_results", "Total tax result messages received")
'@

# Find the exact line index of the Counter import (last one if multiple)
$counterIdx = ($new | ForEach-Object {$_}) |
  ForEach-Object -Begin {$i=0} -Process {
    $out = [PSCustomObject]@{ Text=$_; Index=$i }
    $i++
    $out
  } | Where-Object { $_.Text -match '^\s*from\s+prometheus_client\s+import\s+Counter' } |
  Select-Object -Last 1

if($counterIdx){
  $new.Insert($counterIdx.Index + 1, $guard.TrimEnd())
}else{
  # Fallback: append
  $new.Add($guard.TrimEnd())
}

# 5) Write back
Set-Content -LiteralPath $normMain -Value $new -Encoding UTF8
OK "Repaired $normMain"

# 6) Restart just the normalizer to pick up the change
docker compose restart normalizer | Out-Null
OK "Restarted normalizer"
