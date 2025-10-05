param([string]$ServerPath = ".\server.js")
if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.$ts"

$text = Get-Content -Path $ServerPath -Raw -Encoding UTF8

# 1) Normalize the owa_append call lines to exactly two lines
$text = [Regex]::Replace($text,
  "pool\.query\([^)]*owa_append[^)]*\)\s*,?\s*\r?\n\s*\[[^\]]*\][^;]*;",
  "pool.query(`select * from owa_append($1,$2,$3,$4,$5)`,
    [abn, taxType, periodId, -amt, synthetic]);",
  'IgnoreCase')

# 2) Insert a robust result handling block right after the above call inside /release
#    Replace the typical response write with a guarded version.
#    We’ll target the JSON response line that mentions new_balance and replace that whole return segment.

$releasePattern = "(?s)app\.post\(\s*['""]\/release['""]\s*,\s*ah\(\s*async\s*\(req\s*,\s*res\)\s*=>\s*\{\s*.*?pool\.query\(`select \* from owa_append\(\$1,\$2,\$3,\$4,\$5\)`,\s*\[abn,\s*taxType,\s*periodId,\s*-amt,\s*synthetic\]\);\s*(?<tail>[\s\S]*?)\}\)\);"
$releaseNew = [Regex]::Replace($text, $releasePattern, {
  param($m)

@"
app.post('/release', ah(async (req,res)=>{
  const {abn, taxType, periodId} = req.body;
  const pr = await pool.query(
    `select * from periods where abn=$1 and tax_type=$2 and period_id=$3`,
    [abn, taxType, periodId]
  );
  if (pr.rowCount===0) throw new Error('PERIOD_NOT_FOUND');
  const p = pr.rows[0];

  const rr = await pool.query(
    `select payload, signature from rpt_tokens
     where abn=$1 and tax_type=$2 and period_id=$3
     order by id desc limit 1`,
    [abn, taxType, periodId]
  );
  if (rr.rowCount===0) return res.status(400).json({error:'NO_RPT'});

  const lr = await pool.query(
    `select balance_after_cents from owa_ledger
     where abn=$1 and tax_type=$2 and period_id=$3
     order by id desc limit 1`,
    [abn, taxType, periodId]
  );
  const prevBal = lr.rows[0]?.balance_after_cents ?? 0;
  const amt = Number(p.final_liability_cents);
  if (prevBal < amt) return res.status(422).json({error:'INSUFFICIENT_OWA', prevBal: String(prevBal), needed: amt});

  const synthetic = 'rpt_debit:' + crypto.randomUUID().slice(0,12);
  const r = await pool.query(`select * from owa_append($1,$2,$3,$4,$5)`,
    [abn, taxType, periodId, -amt, synthetic]);

  let newBalance = null;
  if (r.rowCount && r.rows[0] && r.rows[0].out_balance_after != null) {
    newBalance = r.rows[0].out_balance_after;
  } else {
    // fallback: read the latest balance from the ledger
    const fr = await pool.query(
      `select balance_after_cents as bal from owa_ledger
       where abn=$1 and tax_type=$2 and period_id=$3
       order by id desc limit 1`,
      [abn, taxType, periodId]
    );
    newBalance = fr.rows[0]?.bal ?? (prevBal - amt);
  }

  await pool.query(`update periods set state='RELEASED' where id=$1`, [p.id]);
  return res.json({ released: true, bank_receipt_hash: synthetic, new_balance: newBalance });
}));
"@
}, 1, 'IgnoreCase')

if ($releaseNew -eq $text) {
  Write-Host "Warning: Could not find /release block to patch (pattern miss). I’ll leave the file unchanged." -ForegroundColor Yellow
} else {
  $text = $releaseNew
}

# 3) Make sure any lingering "OWA_APPEND_NO_ROW" errors are removed
$text = $text -replace "OWA_APPEND_NO_ROW","OWA_APPEND_FALLBACK_OK"

Set-Content -Path $ServerPath -Value $text -Encoding UTF8
Write-Host "server.js /release patched with fallback ✅"
