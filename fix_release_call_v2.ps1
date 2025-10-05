param([string]$ServerPath = ".\server.js")
if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.release.$ts"

# Read and split safely (no backtick-regex issues)
$text  = Get-Content -Path $ServerPath -Raw -Encoding UTF8
$lines = $text -split "`r`n|\n"

# Find the /release route
$relStart = -1
for ($i=0; $i -lt $lines.Length; $i++) {
  if ($lines[$i] -match "app\.post\(\s*['""]\/release['""]") { $relStart = $i; break }
}

if ($relStart -ge 0) {
  for ($k=$relStart; $k -lt [Math]::Min($relStart+200, $lines.Length); $k++) {
    if ($lines[$k] -match "pool\.query\(" -and $lines[$k] -match "owa_append") {
      # IMPORTANT: use single-quoted PowerShell string so JS backticks survive
      $lines[$k] = '  const r = await pool.query(`select * from owa_append($1,$2,$3,$4,$5)`,'
      # Force arg array on the next line; preserve any trailing )); on that line
      if ($k+1 -lt $lines.Length) {
        $tail = ($lines[$k+1] -replace '.*\]', '')
        $lines[$k+1] = '    [abn, taxType, periodId, -amt, synthetic]' + $tail
      } else {
        $lines += '    [abn, taxType, periodId, -amt, synthetic]);'
      }
      break
    }
  }
}

# Save back
$final = ($lines -join "`r`n")
Set-Content -Path $ServerPath -Value $final -Encoding UTF8

# Show the patched query lines for sanity
$final -split "`r`n" | Where-Object { $_ -match "owa_append\(\$1,\$2,\$3,\$4,\$5\)" -or $_ -match "\[abn,\s*taxType,\s*periodId,\s*-amt,\s*synthetic\]" } | ForEach-Object { Write-Host ">> $_" -ForegroundColor Green }

Write-Host "Patched /release call ✅"
