param(
  [string]$Db="apgms",
  [string]$Host="127.0.0.1",
  [string]$User="apgms",
  [string]$Port="5432",
  [string]$DbPassword = $env:PGPASSWORD
)

if (-not $DbPassword) {
  Write-Host "PGPASSWORD not found in env; you can pass -DbPassword '...'" -ForegroundColor Yellow
}

# SQL with RETURN QUERY so a row is always returned
$sql = @"
BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP FUNCTION IF EXISTS owa_append(text,text,text,bigint,text);

CREATE OR REPLACE FUNCTION owa_append(
  p_abn text,
  p_tax text,
  p_period text,
  p_amount bigint,
  p_bank_receipt text
)
RETURNS TABLE (
  out_id int,
  out_amount_cents bigint,
  out_balance_after bigint,
  out_bank_receipt_hash text,
  out_prev_hash text,
  out_hash_after text
)
LANGUAGE plpgsql
AS \$fn\$
DECLARE
  v_prev_balance bigint := 0;
  v_prev_hash text := NULL;
  v_new_balance bigint;
  v_hash_after text;
BEGIN
  -- last known
  SELECT ol.balance_after_cents, ol.hash_after
    INTO v_prev_balance, v_prev_hash
    FROM owa_ledger AS ol
   WHERE ol.abn = p_abn
     AND ol.tax_type = p_tax
     AND ol.period_id = p_period
   ORDER BY ol.id DESC
   LIMIT 1;

  IF v_prev_balance IS NULL THEN
    v_prev_balance := 0;
  END IF;

  v_new_balance := v_prev_balance + p_amount;
  v_hash_after  := md5( coalesce(v_prev_hash,'') || ':' || v_new_balance::text );

  -- Always return a row:
  RETURN QUERY
    INSERT INTO owa_ledger(
        abn, tax_type, period_id, amount_cents,
        balance_after_cents, bank_receipt_hash, prev_hash, hash_after,
        transfer_uuid
    ) VALUES (
        p_abn, p_tax, p_period, p_amount,
        v_new_balance, p_bank_receipt, v_prev_hash, v_hash_after,
        uuid_generate_v4()
    )
    RETURNING
      owa_ledger.id,
      owa_ledger.amount_cents,
      owa_ledger.balance_after_cents,
      owa_ledger.bank_receipt_hash,
      owa_ledger.prev_hash,
      owa_ledger.hash_after;

END;
\$fn\$;

COMMIT;
"@

# write as UTF-8 *no BOM*
$tmp = Join-Path $env:TEMP "fix_owa_append_v7.sql"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmp, $sql, $Utf8NoBom)

# run psql
if ($DbPassword) { $env:PGPASSWORD = $DbPassword }
$cmd = "psql -v ON_ERROR_STOP=1 -h $Host -U $User -d $Db -p $Port -f `"$tmp`""
Write-Host $cmd
cmd /c $cmd
if ($LASTEXITCODE -ne 0) { throw "Failed to recreate owa_append()" }
Write-Host "owa_append() recreated (v7) ✅"
