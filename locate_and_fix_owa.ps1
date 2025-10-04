param([string]$ServerPath = ".\server.js")
if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.owa.$ts"

# Read
$lines = (Get-Content -Path $ServerPath -Raw -Encoding UTF8) -split "`r`n|\n"

# Helper: print a small snippet safely
function ShowSnippet($idx){
  $a = [Math]::Max(0, $idx-2)
  $b = [Math]::Min($lines.Length-1, $idx+2)
  for($i=$a; $i -le $b; $i++){ "{0,4}: {1}" -f $i, $lines[$i] | Write-Host }
}

$found = $false
for ($i=0; $i -lt $lines.Length; $i++){
  if ($lines[$i] -like "*owa_append*") {
    $found = $true
    Write-Host "`n>>> Found 'owa_append' near line $i. Current snippet:" -ForegroundColor Yellow
    ShowSnippet $i

    # Find the pool.query( line at or above (within 6 lines)
    $p = -1
    for ($k=$i; $k -ge [Math]::Max(0,$i-6); $k--){
      if ($lines[$k] -like "*pool.query(*") { $p = $k; break }
    }
    if ($p -lt 0 -and $lines[$i] -like "*pool.query(*") { $p = $i }

    if ($p -ge 0) {
      # Force the exact two lines, preserving any tail on the array line (e.g., "]);" or "));")
      $lines[$p] = '  const r = await pool.query(`select * from owa_append($1,$2,$3,$4,$5)`,'
      $tail = ""
      if ($p+1 -lt $lines.Length) { $tail = ($lines[$p+1] -replace '.*\]', '') }
      $lines[$p+1] = '    [abn, taxType, periodId, -amt, synthetic]' + $tail

      Write-Host ">>> Rewritten snippet:" -ForegroundColor Green
      ShowSnippet $p
    } else {
      Write-Host "!!! Could not locate a nearby 'pool.query(' for this 'owa_append' occurrence." -ForegroundColor Red
    }
  }
}

if (-not $found) {
  Write-Host "No 'owa_append' found anywhere in server.js" -ForegroundColor Yellow
}

# Save
Set-Content -Path $ServerPath -Value ($lines -join "`r`n") -Encoding UTF8
Write-Host "`nPatched any pool.query/owa_append occurrences (if found) ✅"
