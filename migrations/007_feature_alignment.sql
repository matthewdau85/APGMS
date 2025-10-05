do $$ begin
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

create table if not exists bank_transfers(
  id uuid primary key, abn text not null, amount_cents bigint not null,
  channel text not null, reference text, status text not null, created_at timestamptz not null default now()
);

create table if not exists payroll_events(
  id uuid default gen_random_uuid() primary key, abn text not null,
  gross_cents bigint not null, payg_cents bigint not null, occurred_at timestamptz not null
);

create table if not exists bas_labels(
  id bigserial primary key, abn text not null, period_id bigint not null,
  label text not null, value_cents bigint not null
);
