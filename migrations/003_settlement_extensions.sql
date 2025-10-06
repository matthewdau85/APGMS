-- 003_settlement_extensions.sql
create table if not exists sim_settlements (
  id bigserial primary key,
  provider_ref text not null,
  rail text not null,
  amount_cents bigint not null,
  abn text not null,
  period_id text not null,
  idem_key text not null,
  paid_at timestamptz not null,
  created_at timestamptz default now(),
  unique (idem_key),
  unique (provider_ref)
);

create table if not exists settlements (
  id bigserial primary key,
  provider_ref text not null,
  abn text not null,
  tax_type text not null,
  period_id text not null,
  rail text not null,
  amount_cents bigint not null,
  paid_at timestamptz not null,
  simulated boolean default false,
  verified boolean default false,
  created_at timestamptz default now(),
  verified_at timestamptz,
  idem_key text,
  unique (provider_ref)
);

create index if not exists idx_settlements_period on settlements(abn, tax_type, period_id);

create table if not exists settlement_imports (
  id bigserial primary key,
  raw_payload text not null,
  imported_at timestamptz default now()
);

alter table periods add column if not exists settlement_verified boolean default false;
