# patch_release_owa_append.ps1
$path = ".\server.js"
if (!(Test-Path $path)) { throw "server.js not found" }

$js = Get-Content -Raw $path

# Replace the SELECT * call inside /release with an explicit column list and typed record alias.
$pattern = 'select\s*\*\s*from\s*owa_append\(\$1,\$2,\$3,\$4,\$5\)'
$replacement = @"
select id,
       amount_cents,
       balance_after as balance_after,
       bank_receipt_hash,
       prev_hash,
       hash_after
from owa_append($1,$2,$3,$4,$5) as t(
  id int,
  amount_cents bigint,
  balance_after bigint,
  bank_receipt_hash text,
  prev_hash text,
  hash_after text
)
"@.Trim()

$patched = [regex]::Replace($js, $pattern, $replacement, 'IgnoreCase')

# Safety check: ensure something changed
if ($patched -eq $js) {
  Write-Host "No changes applied (pattern not found)."
} else {
  # Write UTF-8 (no BOM)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Resolve-Path $path), $patched, $utf8NoBom)
  Write-Host "Patched /release owa_append() call ✅"
}

# restart server
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
node .\server.js
