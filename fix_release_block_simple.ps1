# fix_release_block_simple.ps1
$path = ".\server.js"
if (-not (Test-Path $path)) { throw "server.js not found" }

# read & backup
$orig = Get-Content $path -Raw -Encoding UTF8
$bak  = "$path.bak.release." + (Get-Date -Format "yyyyMMdd_HHmmss")
Set-Content $bak $orig -Encoding UTF8

# regex to capture the whole /release route (balanced enough for our formatting)
$pattern = '(?s)app\.post\(\s*[\'"]/release[\'"]\s*,[\s\S]*?\)\);\s*'

# canonical /release implementation (single-quoted here-string keeps backticks intact)
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

$fixed = [regex]::Replace($orig, $pattern, $replacement)
if ($fixed -eq $orig) { throw "Did not find /release route to replace." }

Set-Content $path $fixed -Encoding UTF8
Write-Host "Replaced /release route with canonical block ✅"
