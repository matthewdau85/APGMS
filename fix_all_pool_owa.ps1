param([string]$ServerPath = ".\server.js")
if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.poolowa.$ts"

# Read as lines (keep endings simple)
$lines = (Get-Content -Path $ServerPath -Raw -Encoding UTF8) -split "`r`n|\n"

function FindPoolQueryCallEnd([int]$startIndex) {
  # Returns the index of the line where the pool.query( ... ) closes (depth back to 0)
  $depth = 0
  $started = $false
  for ($k=$startIndex; $k -lt $lines.Length; $k++) {
    $line = $lines[$k]

    # If we haven't started, detect the first occurrence of "pool.query("
    if (-not $started) {
      $idx = $line.IndexOf("pool.query(")
      if ($idx -ge 0) {
        $started = $true
        $depth = 1
        # Continue scanning rest of the current line after "pool.query("
        $rest = $line.Substring($idx + "pool.query(".Length)
        foreach ($ch in $rest.ToCharArray()) {
          if ($ch -eq '(') { $depth++ }
          elseif ($ch -eq ')') { $depth-- }
        }
        if ($depth -eq 0) { return $k } # closed on same line
        continue
      } else {
        continue
      }
    } else {
      foreach ($ch in $line.ToCharArray()) {
        if ($ch -eq '(') { $depth++ }
        elseif ($ch -eq ')') { $depth-- }
      }
      if ($depth -eq 0) { return $k }
    }
  }
  return -1
}

$replacements = 0

for ($i=0; $i -lt $lines.Length; $i++) {
  if ($lines[$i] -like "*pool.query(*") {
    # Find the end of this pool.query(...) call
    $endIdx = FindPoolQueryCallEnd $i
    if ($endIdx -lt 0) { continue }

    # Join the block to see if it contains 'owa_append'
    $block = ($lines[$i..$endIdx] -join "`n")
    if ($block -notlike "*owa_append*") { continue }

    # Replace whole block with clean 2-line call
    # We’ll respect the existing indent of the 'pool.query(' line
    $indent = ($lines[$i] -replace '^( *).*','$1')
    $newBlock = @(
      ($indent + 'const r = await pool.query(`select * from owa_append($1,$2,$3,$4,$5)`,'),
      ($indent + '  [abn, taxType, periodId, -amt, synthetic]);')
    )

    # Splice
    $before = @()
    if ($i -gt 0) { $before = $lines[0..($i-1)] }
    $after  = @()
    if ($endIdx + 1 -le $lines.Length - 1) { $after = $lines[($endIdx+1)..($lines.Length-1)] }
    $lines = $before + $newBlock + $after

    $replacements++
    # Move cursor forward past the new block
    $i = $i + $newBlock.Length - 1
  }
}

Set-Content -Path $ServerPath -Value ($lines -join "`r`n") -Encoding UTF8

Write-Host "Replaced $replacements pool.query(...owa_append...) call(s) with a clean two-liner. ✅"
