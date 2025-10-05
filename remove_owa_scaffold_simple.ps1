param([string]$ServerPath = ".\server.js")
if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.scaffold.$ts"

# Load lines
$lines = (Get-Content -Path $ServerPath -Raw -Encoding UTF8) -split "`r`n|\n"

$new = New-Object System.Collections.Generic.List[string]
$removedBlocks = 0
$i = 0

while ($i -lt $lines.Length) {
  $line = $lines[$i]

  # Look for the scaffold block opener
  if ($line -match '^\s*from\s+owa_append\(\s*,\s*,\s*,\s*,\s*\)\s+as\s+t\(') {
    # Determine the start of the removal (two lines before if possible)
    $dropStart = [Math]::Max(0, $i - 2)

    # Walk forward until we hit a line whose trimmed content is exactly ")"
    $j = $i
    $foundEnd = $false
    while ($j -lt $lines.Length) {
      if ($lines[$j].Trim() -eq ')') {
        $foundEnd = $true
        break
      }
      $j++
    }
    if (-not $foundEnd) {
      # If no closing-paren line, just stop at current i (defensive)
      $j = $i
    }

    # Skip everything from dropStart..j (inclusive)
    $i = $j + 1
    $removedBlocks++
    continue
  }

  # Keep the current line
  $new.Add($line)
  $i++
}

Set-Content -Path $ServerPath -Value ($new -join "`r`n") -Encoding UTF8
Write-Host "Removed $removedBlocks owa_append scaffold block(s). ✅"
