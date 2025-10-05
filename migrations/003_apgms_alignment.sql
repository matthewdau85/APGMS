-- Idempotent alignment for ledger + tokens + payto + settlements
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='ledger' and column_name='period_id') then
    alter table ledger add column period_id bigint;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='ledger' and column_name='hash_head') then
    alter table ledger add column hash_head text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='ledger' and column_name='release_uuid') then
    alter table ledger add column release_uuid uuid;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='ledger' and column_name='rpt_verified') then
    alter table ledger add column rpt_verified boolean default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='ledger' and column_name='bank_receipt_id') then
    alter table ledger add column bank_receipt_id text;
  end if;
end $$;

create table if not exists rpt_tokens (
  id bigserial primary key,
  abn text not null,
  period_id bigint not null,
  token text not null,
  issued_at timestamptz not null default now()
);

create table if not exists idempotency (
  id bigserial primary key,
  key text unique not null,
  seen_at timestamptz not null default now()
);

create table if not exists evidence_bundles (
  id bigserial primary key,
  abn text not null,
  period_id bigint not null,
  rpt_token text,
  delta_cents bigint not null,
  tolerance_bps integer not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists bas_labels(
  id bigserial primary key,
  abn text not null,
  period_id bigint not null,
  label text not null,
  value_cents bigint not null
);

create table if not exists payto_mandates (
  id uuid primary key,
  abn text not null,
  payid text not null,
  creditor_name text not null,
  max_amount_cents bigint not null,
  status text not null check (status in ('ACTIVE','CANCELLED')),
  created_at timestamptz not null default now()
);

create table if not exists payto_sweeps (
  id bigserial primary key,
  mandate_id uuid not null references payto_mandates(id),
  abn text not null,
  amount_cents bigint not null,
  reference text,
  created_at timestamptz not null default now()
);

create table if not exists settlements (
  id bigserial primary key,
  abn text not null,
  period_id bigint not null,
  settlement_ref text not null,
  paid_at timestamptz not null,
  amount_cents bigint not null,
  channel text,
  created_at timestamptz not null default now()
);
