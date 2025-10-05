-- 001_apgms_core.sql
create table if not exists periods (
  id serial primary key,
  abn text not null,
  tax_type text not null check (tax_type in ('PAYGW','GST')),
  period_id text not null,
  state text not null default 'OPEN',
  basis text default 'ACCRUAL',
  accrued_cents bigint default 0,
  credited_to_owa_cents bigint default 0,
  final_liability_cents bigint default 0,
  merkle_root text,
  running_balance_hash text,
  anomaly_vector jsonb default '{}',
  thresholds jsonb default '{}',
  unique (abn, tax_type, period_id)
);

create table if not exists owa_ledger (
  id bigserial primary key,
  abn text not null,
  tax_type text not null,
  period_id text not null,
  transfer_uuid uuid not null,
  amount_cents bigint not null,
  balance_after_cents bigint not null,
  bank_receipt_hash text,
  prev_hash text,
  hash_after text,
  created_at timestamptz default now(),
  unique (transfer_uuid)
);

create index if not exists idx_owa_balance on owa_ledger(abn, tax_type, period_id, id);

create table if not exists rpt_tokens (
  id bigserial primary key,
  abn text not null,
  tax_type text not null,
  period_id text not null,
  payload jsonb not null,
  signature text not null,
  status text not null default 'ISSUED',
  created_at timestamptz default now()
);

create table if not exists audit_log (
  seq bigserial primary key,
  ts timestamptz default now(),
  actor text not null,
  action text not null,
  payload_hash text not null,
  prev_hash text,
  terminal_hash text
);

create table if not exists remittance_destinations (
  id serial primary key,
  abn text not null,
  label text not null,
  rail text not null,
  reference text not null,
  account_bsb text,
  account_number text,
  unique (abn, rail, reference)
);

do $$
begin
  create type idempotency_status as enum ('pending','applied','failed');
exception when duplicate_object then
  null;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'idempotency_keys'
      and column_name = 'key'
  ) then
    execute 'alter table idempotency_keys rename column key to id';
  end if;
exception when undefined_table then
  null;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'idempotency_keys'
      and column_name = 'created_at'
  ) then
    execute 'alter table idempotency_keys rename column created_at to first_seen_at';
  end if;
exception when undefined_table then
  null;
end $$;

create table if not exists idempotency_keys (
  id text primary key,
  first_seen_at timestamptz not null default now(),
  status idempotency_status not null default 'pending',
  response_hash text,
  failure_cause text,
  ttl_secs int not null default 86400
);

alter table if exists idempotency_keys
  add column if not exists failure_cause text,
  add column if not exists ttl_secs int not null default 86400,
  add column if not exists status idempotency_status not null default 'pending',
  add column if not exists first_seen_at timestamptz not null default now();

alter table if exists idempotency_keys
  alter column first_seen_at set default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'idempotency_keys'
      and column_name = 'last_status'
  ) then
    update idempotency_keys
      set status = case
        when coalesce(lower(last_status), '') in ('done','applied','complete') then 'applied'
        when coalesce(lower(last_status), '') in ('failed','error') then 'failed'
        when coalesce(lower(last_status), '') = '' then status
        else 'pending'
      end
      where status = 'pending';
    alter table idempotency_keys drop column if exists last_status;
  end if;
exception when undefined_table then
  null;
end $$;

create table if not exists idempotency_responses (
  hash text primary key,
  status_code int not null,
  body jsonb not null,
  content_type text,
  headers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_idempotency_keys_status on idempotency_keys(status);
