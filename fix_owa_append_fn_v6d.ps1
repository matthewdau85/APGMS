# fix_owa_append_fn_v6d.ps1
param(
  [string]$Db      = "apgms",
  [string]$DbHost  = "127.0.0.1",
  [string]$User    = "apgms",
  [string]$Port    = "5432",
  [string]$Password
)

function Get-PlainPassword {
  param([string]$Password)
  if ($Password) { return $Password }
  if ($env:PGPASSWORD) { return $env:PGPASSWORD }
  if (Test-Path ".env.local") {
    $line = (Get-Content .env.local | Where-Object { $_ -match '^\s*PGPASSWORD\s*=' } | Select-Object -First 1)
    if ($line) {
      $val = ($line -split '=',2)[1].Trim()
      if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length-2) }
      if ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length-2) }
      if ($val) { return $val }
    }
  }
  $sec = Read-Host -Prompt "Enter Postgres password for user '$User'" -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$pw = Get-PlainPassword -Password $Password

$fn = @'
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
AS $fn$
DECLARE
  v_prev_balance bigint := 0;
  v_prev_hash text := NULL;
  v_new_balance bigint;
  v_hash_after text;
BEGIN
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
      owa_ledger.hash_after
    INTO
      out_id,
      out_amount_cents,
      out_balance_after,
      out_bank_receipt_hash,
      out_prev_hash,
      out_hash_after;

  RETURN;
END;
$fn$;

COMMIT;
'@

$tmp = Join-Path $env:TEMP "fix_owa_append_v6d.sql"

# WRITE WITHOUT BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmp, $fn, $utf8NoBom)

# Run psql with password set for this process only
$old = $env:PGPASSWORD
$env:PGPASSWORD = $pw
try {
  $psql = "psql -v ON_ERROR_STOP=1 -h $DbHost -U $User -d $Db -p $Port -f `"$tmp`""
  Write-Host $psql
  cmd /c $psql
  if ($LASTEXITCODE -ne 0) { throw "Failed to recreate owa_append()" }
  Write-Host "owa_append() recreated (v6d) ✅"
}
finally {
  if ($null -ne $old) { $env:PGPASSWORD = $old } else { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
}
