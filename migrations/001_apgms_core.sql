-- 001_apgms_core.sql

-- cryptographic helpers for gen_random_uuid() + digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
  transfer_uuid uuid not null default gen_random_uuid(),
  amount_cents bigint not null,
  balance_after_cents bigint not null,
  bank_receipt_hash text,
  prev_hash text,
  hash_after text,
  rpt_verified boolean not null default false,
  release_uuid uuid,
  bank_receipt_id text,
  created_at timestamptz not null default now(),
  constraint owa_release_guard
    check (
      amount_cents >= 0
      or (amount_cents < 0 and rpt_verified = true and release_uuid is not null)
    ),
  unique (transfer_uuid)
);

create index if not exists idx_owa_balance on owa_ledger(abn, tax_type, period_id, id);

create table if not exists rpt_tokens (
  id bigserial primary key,
  abn text not null,
  tax_type text not null,
  period_id text not null,
  payload jsonb not null,
  payload_c14n text,
  payload_sha256 text,
  signature text not null,
  key_id text,
  nonce text,
  expires_at timestamptz,
  status text not null default 'ISSUED',
  created_at timestamptz not null default now()
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

create table if not exists idempotency_keys (
  key text primary key,
  created_at timestamptz default now(),
  last_status text,
  response_hash text
);
