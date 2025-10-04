# fix_release_call_literal.ps1
$path = ".\server.js"
if (-not (Test-Path $path)) { throw "server.js not found" }

$orig = Get-Content $path -Raw -Encoding UTF8
$bak  = "$path.bak.release." + (Get-Date -Format "yyyyMMdd_HHmmss")
Set-Content $bak $orig -Encoding UTF8

# Replace the lines between the synthetic receipt and the period state update.
$pattern = '(?s)(const synthetic\s*=\s*.+?;\s*)([\s\S]*?)(\s*await\s+pool\.query\(\s*`update periods set state=''RELEASED'' where id=\$1`\s*,\s*\[p\.id\]\s*\)\s*;)'
$replacement = @"
`$1const r = await pool.query(
  `select
     out_id                as id,
     out_amount_cents      as amount_cents,
     out_balance_after     as balance_after,
     out_bank_receipt_hash as bank_receipt_hash,
     out_prev_hash         as prev_hash,
     out_hash_after        as hash_after
   from owa_append($1,$2,$3,$4,$5)`,
  [abn, taxType, periodId, -amt, synthetic]
);

if (r.rowCount !== 1) {
  console.error('owa_append returned no row', { rowCount: r.rowCount });
  return res.status(500).json({ error: 'OWA_APPEND_NO_ROW' });
}
`$3
"@

$fixed = [System.Text.RegularExpressions.Regex]::Replace($orig, $pattern, $replacement)
if ($fixed -eq $orig) { throw "Pattern not found; no change made." }

Set-Content $path $fixed -Encoding UTF8
Write-Host "Patched /release debit call ✅"
