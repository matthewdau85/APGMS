# patch_release_sql_dropin.ps1
$path = ".\server.js"
if (!(Test-Path $path)) { throw "server.js not found" }

$src = Get-Content -Raw $path

# Match the whole pool.query(...) that calls owa_append(...) inside /release,
# and replace it with a clean, valid SELECT that explicitly types the record.
$pattern = '(?s)const\s+r\s*=\s*await\s+pool\.query\(\s*`[^`]*owa_append\(\$1,\$2,\$3,\$4,\$5\)[^`]*`\s*,\s*\[\s*abn\s*,\s*taxType\s*,\s*periodId\s*,\s*-[^]]*?\]\s*\);'

$replacement = @"
const r = await pool.query(
  `select id,
          amount_cents,
          balance_after,
          bank_receipt_hash,
          prev_hash,
          hash_after
     from owa_append($1,$2,$3,$4,$5)
     as o(
       id int,
       amount_cents bigint,
       balance_after bigint,
       bank_receipt_hash text,
       prev_hash text,
       hash_after text
     )`,
  [abn, taxType, periodId, -amt, synthetic]
);
"@.Trim()

$patched = [regex]::Replace($src, $pattern, $replacement)

if ($patched -eq $src) {
  Write-Host "No match found. Showing a quick diff-style hint so you can patch by hand:"
  Write-Host "---- FIND (roughly) ----"
  $src -split "`n" | Where-Object { $_ -match 'owa_append\(\$1,\$2,\$3,\$4,\$5\)' } | ForEach-Object { "  $_" }
  Write-Host "------------------------"
  Write-Host "Replace the whole pool.query(...) that contains that line with the replacement block shown in the script."
  exit 1
}

# Write back (UTF-8 no BOM) and restart node
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Resolve-Path $path), $patched, $utf8NoBom)
Write-Host "Patched /release SQL ✅"

Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
node .\server.js
