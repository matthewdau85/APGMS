param([string]$ServerPath = ".\server.js")

if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.release.$ts"

$lines = Get-Content -Path $ServerPath -Raw -Encoding UTF8 -split "`r?`n"

# Find the /release route block and normalize the SQL + argument array.
for ($i=0; $i -lt $lines.Length; $i++) {
  # locate the pool.query line that calls owa_append
  if ($lines[$i] -match 'pool\.query\(\s*[`"\']select\s+\*\s+from\s+owa_append\(') {
    # Normalize the SQL text in that same line
    $lines[$i] = $lines[$i] -replace 'select\s+\*\s+from\s+owa_append\s*\([\s\S]*?\)', 'select * from owa_append($1,$2,$3,$4,$5)'

    # Now walk forward up to 8 lines to find the argument array [...] and replace it
    for ($j = $i; $j -lt [Math]::Min($i+8, $lines.Length); $j++) {
      if ($lines[$j] -match '\[\s*abn\s*,\s*taxType\s*,\s*periodId') {
        # Force the correct array (covers both cases where ) is at end-of-line or next line)
        # We preserve any trailing ), or )) as-is by re-appending from the original line.
        $trailing = ($lines[$j] -replace '.*\]', '')  # capture text after the closing bracket
        $lines[$j] = '    [abn, taxType, periodId, -amt, synthetic]' + $trailing
        break
      }
    }
  }
}

# Save
$final = ($lines -join "`r`n")
Set-Content -Path $ServerPath -Value $final -Encoding UTF8
Write-Host "Patched $ServerPath (/release call) ✅"
