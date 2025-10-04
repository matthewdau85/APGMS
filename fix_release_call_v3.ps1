param([string]$ServerPath = ".\server.js")
if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.release.$ts"

# Read/split
$text  = Get-Content -Path $ServerPath -Raw -Encoding UTF8
$lines = $text -split "`r`n|\n"

# Find the /release route
$relStart = -1
for ($i=0; $i -lt $lines.Length; $i++) {
  if ($lines[$i] -match "app\.post\(\s*['""]\/release['""]") { $relStart = $i; break }
}

$patchedIndex = -1
if ($relStart -ge 0) {
  for ($k=$relStart; $k -lt [Math]::Min($relStart+200, $lines.Length); $k++) {
    if ($lines[$k] -match "pool\.query\(" -and $lines[$k] -match "owa_append") {
      # Use single-quoted PS literals so JS backticks and $1..$5 survive
      $lines[$k]   = '  const r = await pool.query(`select * from owa_append($1,$2,$3,$4,$5)`,'
      if ($k+1 -lt $lines.Length) {
        $tail       = ($lines[$k+1] -replace '.*\]', '')
        $lines[$k+1]= '    [abn, taxType, periodId, -amt, synthetic]' + $tail
      } else {
        $lines     += '    [abn, taxType, periodId, -amt, synthetic]);'
      }
      $patchedIndex = $k
      break
    }
  }
}

# Save
$final = ($lines -join "`r`n")
Set-Content -Path $ServerPath -Value $final -Encoding UTF8

# Print the two lines we changed directly by index (no regex)
if ($patchedIndex -ge 0) {
  Write-Host ">> $($lines[$patchedIndex])" -ForegroundColor Green
  if ($patchedIndex + 1 -lt $lines.Length) {
    Write-Host ">> $($lines[$patchedIndex+1])" -ForegroundColor Green
  }
} else {
  Write-Host "Did not find a pool.query/owa_append call under /release." -ForegroundColor Yellow
}

Write-Host "Patched /release call ✅"
