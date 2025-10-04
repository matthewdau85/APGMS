# fix_release_block_hard.ps1
$path = ".\server.js"
if (-not (Test-Path $path)) { throw "server.js not found" }

$orig = Get-Content $path -Raw -Encoding UTF8
$bak  = "$path.bak.release." + (Get-Date -Format "yyyyMMdd_HHmmss")
Set-Content $bak $orig -Encoding UTF8

# Find the /release route block and replace it entirely (balanced braces)
# Start anchor:
$startIdx = [Regex]::Match($orig, "app\.post\(\s*['" + '"' + @"]\/release[" + '"' + "']\s*,").Index
if ($startIdx -lt 0) { throw "Could not find app.post('/release', ...)" }

# Walk forward to find the end of the balanced braces of the handler function
$sub = $orig.Substring($startIdx)
$depth = 0
$endRel = -1
for ($i = 0; $i -lt $sub.Length; $i++) {
  $ch = $sub[$i]
  if ($ch -eq '{') { $depth++ }
  elseif ($ch -eq '}') {
    $depth--
    if ($depth -eq 0) { 
      # This is the closing brace of app.post('/release', ... )
      # The route closes with "});"
      # Move forward to the first ");" after this brace
      $j = $i
      while ($j -lt $sub.Length - 1 -and $sub.Substring($j,2) -ne ");") { $j++ }
      if ($j -lt $sub.Length - 1) { $endRel = $j + 2; break }
    }
  }
}

if ($endRel -lt 0) { throw "Could not determine end of /release block." }

$newRelease = @'
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

# Rebuild the file: everything before /release + new block + everything after /release
$prefix = $orig.Substring(0, $startIdx)
$suffix = $sub.Substring($endRel)
$fixed  = $prefix + $newRelease + $suffix

Set-Content $path $fixed -Encoding UTF8
Write-Host "Replaced /release route with canonical block ✅"
