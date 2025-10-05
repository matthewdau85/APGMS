# patch_release_sql_fix.ps1
$path = ".\server.js"
if (!(Test-Path $path)) { throw "server.js not found" }

$js = Get-Content -Raw $path

# Replace the previous patched SELECT ... FROM owa_append(...) block with a simpler, valid form.
# We select explicit columns from a typed record alias (o), which avoids ambiguity and odd parsing.
$pattern = '(?s)select\s+id,\s*amount_cents,.*?from\s+owa_append\(\$1,\$2,\$3,\$4,\$5\).*?hash_after\s+text\s*\)'
$replacement = @"
select id,
       amount_cents,
       balance_after,
       bank_receipt_hash,
       prev_hash,
       hash_after
from owa_append($1,$2,$3,$4,$5) as o(
  id int,
  amount_cents bigint,
  balance_after bigint,
  bank_receipt_hash text,
  prev_hash text,
  hash_after text
)
"@.Trim()

$patched = [regex]::Replace($js, $pattern, $replacement, 'IgnoreCase')

# If that pattern didn't match (e.g., you still have the original `select *`), replace that instead:
if ($patched -eq $js) {
  $patternStar = 'select\s*\*\s*from\s*owa_append\(\$1,\$2,\$3,\$4,\$5\)'
  $patched = [regex]::Replace($js, $patternStar, $replacement, 'IgnoreCase')
}

if ($patched -eq $js) {
  Write-Host "No changes applied (pattern not found)."
} else {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Resolve-Path $path), $patched, $utf8NoBom)
  Write-Host "Patched /release SQL ✅"
}

# restart server
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
node .\server.js
