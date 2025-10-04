# fix_owa_append_fn_v3.ps1
param(
  [string]$DbHost = "127.0.0.1",
  [string]$DbName = "apgms",
  [string]$DbUser = "apgms",
  [string]$DbPort = "5432",
  [string]$DbPwd  = ""
)

# Load from .env.local if present
$envFile = ".\.env.local"
if (Test-Path $envFile) {
  (Get-Content $envFile) | ForEach-Object {
    if ($_ -match '^\s*PGHOST\s*=\s*(.+)\s*$')     {$DbHost=$Matches[1].Trim('"'' ')}
    elseif ($_ -match '^\s*PGDATABASE\s*=\s*(.+)\s*$') {$DbName=$Matches[1].Trim('"'' ')}
    elseif ($_ -match '^\s*PGUSER\s*=\s*(.+)\s*$')     {$DbUser=$Matches[1].Trim('"'' ')}
    elseif ($_ -match '^\s*PGPORT\s*=\s*(.+)\s*$')     {$DbPort=$Matches[1].Trim('"'' ')}
    elseif ($_ -match '^\s*PGPASSWORD\s*=\s*(.+)\s*$') {$DbPwd =$Matches[1].Trim('"'' ')}
  }
}
if ($DbPwd -ne "") { $env:PGPASSWORD = $DbPwd }

# SINGLE-QUOTED here-string so $func$ is literal
$sql = @'
BEGIN;

DROP FUNCTION IF EXISTS public.owa_append(text, text, text, bigint, text);

CREATE FUNCTION public.owa_append(
  p_abn           text,
  p_tax           text,
  p_period        text,
  p_amount        bigint,
  p_bank_receipt  text
) RETURNS TABLE(
  id                   int,
  amount_cents         bigint,
  balance_after_cents  bigint,
  bank_receipt_hash    text,
  prev_hash            text,
  hash_after           text
)
LANGUAGE plpgsql
AS $func$
DECLARE
  v_last_balance  bigint := 0;
  v_last_hash     text   := NULL;
  v_new_balance   bigint;
  v_prev_hash     text;
  v_hash_after    text;
BEGIN
  -- Qualify column names to avoid ambiguity
  SELECT ol.balance_after_cents, ol.hash_after
    INTO v_last_balance, v_last_hash
  FROM owa_ledger AS ol
  WHERE ol.abn = p_abn
    AND ol.tax_type = p_tax
    AND ol.period_id = p_period
  ORDER BY ol.id DESC
  LIMIT 1;

  v_prev_hash   := COALESCE(v_last_hash, 'GENESIS');
  v_new_balance := COALESCE(v_last_balance, 0) + p_amount;

  -- Deterministic chain hash for ledger continuity
  v_hash_after := md5( v_prev_hash || ':' || COALESCE(p_bank_receipt,'') || ':' || v_new_balance::text );

  INSERT INTO owa_ledger(
    abn, tax_type, period_id, amount_cents,
    balance_after_cents, bank_receipt_hash, prev_hash, hash_after
  ) VALUES (
    p_abn, p_tax, p_period, p_amount,
    v_new_balance, p_bank_receipt, v_prev_hash, v_hash_after
  )
  RETURNING id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after
  INTO id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after;

  RETURN NEXT;
END
$func$;

COMMIT;
'@

& psql -h $DbHost -U $DbUser -d $DbName -p $DbPort -v ON_ERROR_STOP=1 -At -c "$sql"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to recreate owa_append function."
} else {
  Write-Host "owa_append function recreated successfully. ✅"
}
