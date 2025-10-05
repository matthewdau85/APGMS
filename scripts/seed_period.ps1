param(
  [string]$DbHost   = "127.0.0.1",
  [string]$DbName   = "apgms",
  [string]$DbUser   = "apgms",
  [string]$DbPwd    = "apgms_pw",
  [string]$Abn      = "12345678901",
  [ValidateSet("GST","PAYGW")]
  [string]$TaxType  = "GST",
  [string]$PeriodId = "2025-10",
  [int]$Credit1     = 60000,
  [int]$Credit2     = 40000,
  [int]$Credit3     = 23456
)

$ErrorActionPreference = "Stop"
$env:PGPASSWORD = $DbPwd

# SQL that always produces a row, even if the ledger is empty
$sql = @"
-- clean period
DELETE FROM rpt_tokens WHERE abn='$Abn' AND tax_type='$TaxType' AND period_id='$PeriodId';
DELETE FROM owa_ledger WHERE abn='$Abn' AND tax_type='$TaxType' AND period_id='$PeriodId';
DELETE FROM periods    WHERE abn='$Abn' AND tax_type='$TaxType' AND period_id='$PeriodId';

-- insert period OPEN
INSERT INTO periods(
  abn,tax_type,period_id,state,basis,accrued_cents,credited_to_owa_cents,final_liability_cents,
  merkle_root,running_balance_hash,anomaly_vector,thresholds
) VALUES(
  '$Abn','$TaxType','$PeriodId','OPEN','ACCRUAL',0,0,0,
  NULL,NULL,
  '{"variance_ratio":0.1,"dup_rate":0.0,"gap_minutes":10,"delta_vs_baseline":0.05}'::jsonb,
  '{"epsilon_cents":0,"variance_ratio":0.25,"dup_rate":0.01,"gap_minutes":60,"delta_vs_baseline":0.2}'::jsonb
);

-- helper CTE that yields a base row even when owa_ledger is empty
WITH seed_base AS (
  SELECT
    COALESCE((SELECT balance_after_cents FROM owa_ledger
              WHERE abn='$Abn' AND tax_type='$TaxType' AND period_id='$PeriodId'
              ORDER BY id DESC LIMIT 1), 0) AS base_bal,
    COALESCE((SELECT hash_after FROM owa_ledger
              WHERE abn='$Abn' AND tax_type='$TaxType' AND period_id='$PeriodId'
              ORDER BY id DESC LIMIT 1), '') AS base_hash
),
ins1 AS (
  INSERT INTO owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after)
  SELECT '$Abn','$TaxType','$PeriodId', gen_random_uuid(),
         $Credit1,
         base_bal + $Credit1,
         'rcpt:'||substr(gen_random_uuid()::text,1,12),
         base_hash,
         encode(digest((base_hash || 'rcpt' || (base_bal + $Credit1)::text)::bytea,'sha256'),'hex')
  FROM seed_base
  RETURNING balance_after_cents, hash_after
),
ins2 AS (
  INSERT INTO owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after)
  SELECT '$Abn','$TaxType','$PeriodId', gen_random_uuid(),
         $Credit2,
         i1.balance_after_cents + $Credit2,
         'rcpt:'||substr(gen_random_uuid()::text,1,12),
         i1.hash_after,
         encode(digest((i1.hash_after || 'rcpt' || (i1.balance_after_cents + $Credit2)::text)::bytea,'sha256'),'hex')
  FROM ins1 i1
  RETURNING balance_after_cents, hash_after
),
ins3 AS (
  INSERT INTO owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after)
  SELECT '$Abn','$TaxType','$PeriodId', gen_random_uuid(),
         $Credit3,
         i2.balance_after_cents + $Credit3,
         'rcpt:'||substr(gen_random_uuid()::text,1,12),
         i2.hash_after,
         encode(digest((i2.hash_after || 'rcpt' || (i2.balance_after_cents + $Credit3)::text)::bytea,'sha256'),'hex')
  FROM ins2 i2
)
-- compute totals and move to CLOSING
UPDATE periods p
   SET credited_to_owa_cents = t.credited,
       final_liability_cents = t.credited,
       state = 'CLOSING'
FROM (
  SELECT COALESCE(SUM(CASE WHEN amount_cents>0 THEN amount_cents ELSE 0 END),0) AS credited
  FROM owa_ledger WHERE abn='$Abn' AND tax_type='$TaxType' AND period_id='$PeriodId'
) t
WHERE p.abn='$Abn' AND p.tax_type='$TaxType' AND p.period_id='$PeriodId';

-- show summary
SELECT abn,tax_type,period_id,state,credited_to_owa_cents,final_liability_cents
FROM periods WHERE abn='$Abn' AND tax_type='$TaxType' AND period_id='$PeriodId';

SELECT id, amount_cents, balance_after_cents, bank_receipt_hash
FROM owa_ledger WHERE abn='$Abn' AND tax_type='$TaxType' AND period_id='$PeriodId' ORDER BY id;
"@

# write NO BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$tmpPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ("seed_" + [System.Guid]::NewGuid().ToString("N") + ".sql"))
[System.IO.File]::WriteAllText($tmpPath, $sql, $utf8NoBom)

Write-Host "== Running seed SQL via file: $tmpPath ==" -ForegroundColor Cyan
& psql -h $DbHost -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -f $tmpPath

Remove-Item $tmpPath -Force -ErrorAction SilentlyContinue
