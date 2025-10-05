do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='ledger' and column_name='direction') then
    alter table ledger add column direction text not null default 'credit';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='ledger' and column_name='amount_cents') then
    alter table ledger add column amount_cents bigint not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='ledger' and column_name='period_id') then
    alter table ledger add column period_id bigint;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='ledger' and column_name='hash_head') then
    alter table ledger add column hash_head text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='ledger' and column_name='rpt_verified') then
    alter table ledger add column rpt_verified boolean default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='ledger' and column_name='bank_receipt_id') then
    alter table ledger add column bank_receipt_id text;
  end if;
end $$;

-- Optional: normalize credit_amount-only rows if present
-- update ledger set amount_cents = coalesce(amount_cents, credit_amount) where amount_cents is null;
