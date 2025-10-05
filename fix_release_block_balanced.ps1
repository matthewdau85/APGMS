# fix_release_block_balanced.ps1
$path = ".\server.js"
if (-not (Test-Path $path)) { throw "server.js not found" }

# Load + backup
$text  = Get-Content -Path $path -Raw -Encoding UTF8
$lines = $text -split "`r`n|\n"
$bak   = "$path.bak.release." + (Get-Date -Format "yyyyMMdd_HHmmss")
Set-Content -Path $bak -Value $text -Encoding UTF8

# Find start of the /release route: a line beginning with app.post('/release', ...) or app.post("/release", ...)
$start = -1
for ($i=0; $i -lt $lines.Length; $i++) {
  if ($lines[$i] -match '^\s*app\.post\(\s*[''"]/release[''"]\s*,') { $start = $i; break }
}
if ($start -lt 0) { throw "Could not find the /release route start." }

# Find the end: first line at/after start that contains '));' (route closing)
$end = -1
for ($j=$start; $j -lt $lines.Length; $j++) {
  if ($lines[$j] -match '\)\);\s*$') { $end = $j; break }
}
if ($end -lt 0) { throw "Could not find the /release route end (looking for '));')." }

# Canonical replacement block (maps OUT columns from owa_append to expected names)
$replacement = @'
app.post('/release', ah(async (req,res)=>{
  const {abn, taxType, periodId} = req.body;
  const pr = await pool.query(
    `select * from periods where abn=$1 and tax_type=$2 and period_id=$3`,
    [abn, taxType, periodId]
  );
  if (pr.rowCount===0) throw new Error('PERIOD_NOT_FOUND');
  const p = pr.rows[0];

  // ensure funds are in OWA
  const lr = await pool.query(
    `select balance_after_cents from owa_ledger
     where abn=$1 and tax_type=$2 and period_id=$3
     order by id desc limit 1`,
    [abn, taxType, periodId]
  );
  const prevBal = lr.rows[0]?.balance_after_cents ?? 0;
  const amt = Number(p.final_liability_cents);
  if (prevBal < amt) return res.status(422).json({error:'INSUFFICIENT_OWA', prevBal: String(prevBal), needed: amt});

  // debit with idempotent synthetic receipt (nonce)
  const synthetic = 'rpt_debit:' + crypto.randomUUID().slice(0,12);
  const r = await pool.query(
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
    console.error('owa_append returned unexpected rowCount', r.rowCount);
    return res.status(500).json({ error: 'OWA_APPEND_NO_ROW' });
  }

  await pool.query(`update periods set state='RELEASED' where id=$1`, [p.id]);
  res.json({
    released: true,
    bank_receipt_hash: synthetic,
    new_balance: r.rows[0].balance_after
  });
}));
'@

# Splice: keep everything before start, then replacement, then everything after end
$before = if ($start -gt 0) { $lines[0..($start-1)] } else { @() }
$after  = if ($end + 1 -le $lines.Length - 1) { $lines[($end+1)..($lines.Length-1)] } else { @() }

# Write back (normalize to CRLF)
$outLines = @()
$outLines += $before
$outLines += ($replacement -split "`r`n|\n")
$outLines += $after
Set-Content -Path $path -Value ($outLines -join "`r`n") -Encoding UTF8

Write-Host "Replaced /release route ✅  (backup: $bak)"
