create extension if not exists pgcrypto;

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null,
  rail text not null check (rail in ('EFT','BPAY')),
  provider_ref text not null,
  amount_cents bigint not null,
  paid_at timestamptz not null,
  meta jsonb default '{}'::jsonb,
  simulated boolean default false,
  unique(provider_ref)
);

alter table owa_ledger add column if not exists bank_receipt_id text;
alter table owa_ledger add column if not exists rpt_verified boolean default false;
alter table owa_ledger add column if not exists release_uuid uuid;

alter table idempotency_keys add column if not exists response_json jsonb;
