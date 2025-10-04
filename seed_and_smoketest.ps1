# seed_and_smoketest.ps1  (fixed)
param(
  [string]$DbHost = "127.0.0.1",
  [string]$DbName = "apgms",
  [string]$DbUser = "apgms",
  [string]$DbPwd  = "Mnd19857!!"
)

$ErrorActionPreference = "Stop"
$env:PGPASSWORD = $DbPwd

# Locate psql
$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
if (!(Test-Path $psql)) { $psql = "psql" }

function psqlc([string]$sql) {
  & $psql -h $DbHost -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -c $sql
}

Write-Host "== Clean prior demo data (idempotent) =="
psqlc @"
delete from owa_ledger where abn='12345678901' and tax_type='GST' and period_id='2025-09';
delete from rpt_tokens  where abn='12345678901' and tax_type='GST' and period_id='2025-09';
delete from periods     where abn='12345678901' and tax_type='GST' and period_id='2025-09';
"@

Write-Host "== Seeding ATO allow-list destinations =="
psqlc @"
insert into remittance_destinations (abn,label,rail,reference,account_bsb,account_number)
values ('12345678901','ATO_EFT','EFT','1234567890','092-009','12345678')
on conflict (abn, rail, reference) do nothing;

insert into remittance_destinations (abn,label,rail,reference)
values ('12345678901','ATO_BPAY','BPAY','987654321')
on conflict (abn, rail, reference) do nothing;
"@

Write-Host "== Upserting demo period (GST 2025-09) with valid JSON =="
psqlc @"
insert into periods (
  abn,tax_type,period_id,state,basis,
  accrued_cents,credited_to_owa_cents,final_liability_cents,
  merkle_root,running_balance_hash,anomaly_vector,thresholds
) values (
  '12345678901','GST','2025-09','OPEN','ACCRUAL',
  0,0,0,
  'merkle_demo_root','rbh_demo',
  '{""variance_ratio"":0.1,""dup_rate"":0.0,""gap_minutes"":10,""delta_vs_baseline"":0.05}'::jsonb,
  '{""epsilon_cents"":50,""variance_ratio"":0.25,""dup_rate"":0.01,""gap_minutes"":60,""delta_vs_baseline"":0.2}'::jsonb
)
on conflict (abn,tax_type,period_id) do nothing;
"@

Write-Host "== Simulate OWA credits (period accruals) =="
psqlc @"
with credits as (
  select *
  from (values
    (1::int, 50000::bigint),  -- $500.00
    (2::int, 40000::bigint),  -- $400.00
    (3::int, 33456::bigint)   -- $334.56
  ) v(n, amount_cents)
)
insert into owa_ledger (
  abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,
  bank_receipt_hash,prev_hash,hash_after
)
select
  '12345678901','GST','2025-09',
  gen_random_uuid(),
  c.amount_cents,
  sum(c.amount_cents) over (order by c.n rows between unbounded preceding and current row) as balance_after_cents,
  ('rcpt:' || gen_random_uuid()::text) as bank_receipt_hash,
  null::text as prev_hash,
  null::text as hash_after
from credits c
order by c.n;

update periods
   set credited_to_owa_cents = (select coalesce(sum(amount_cents),0) from owa_ledger where abn='12345678901' and tax_type='GST' and period_id='2025-09'),
       accrued_cents         = credited_to_owa_cents
 where abn='12345678901' and tax_type='GST' and period_id='2025-09';
"@

Write-Host "== Set final liability to match credits and move to CLOSING =="
psqlc @"
update periods
   set final_liability_cents = credited_to_owa_cents,
       state='CLOSING'
 where abn='12345678901' and tax_type='GST' and period_id='2025-09';
"@

Write-Host "== Show period/ledger =="
psqlc "select abn,tax_type,period_id,state,accrued_cents,credited_to_owa_cents,final_liability_cents from periods where abn='12345678901' and tax_type='GST' and period_id='2025-09';"
psqlc "select id,amount_cents,balance_after_cents,bank_receipt_hash from owa_ledger where abn='12345678901' and tax_type='GST' and period_id='2025-09' order by id;"
