-- 003_ingest_recon.sql
create table if not exists tenant_webhook_secrets (
  id serial primary key,
  tenant_id text not null unique,
  secret text not null,
  created_at timestamptz default now()
);

create table if not exists payroll_events (
  id bigserial primary key,
  tenant_id text not null,
  tax_type text not null,
  period_id text not null,
  source_id text not null,
  payload jsonb not null,
  raw_payload jsonb,
  received_at timestamptz default now(),
  signature text,
  hmac_valid boolean default false
);

create index if not exists idx_payroll_events_period on payroll_events(tenant_id, tax_type, period_id);

create table if not exists pos_events (
  id bigserial primary key,
  tenant_id text not null,
  tax_type text not null,
  period_id text not null,
  source_id text not null,
  payload jsonb not null,
  raw_payload jsonb,
  received_at timestamptz default now(),
  signature text,
  hmac_valid boolean default false
);

create index if not exists idx_pos_events_period on pos_events(tenant_id, tax_type, period_id);

create table if not exists ingest_dlq (
  id bigserial primary key,
  tenant_id text,
  endpoint text not null,
  reason text not null,
  payload jsonb not null,
  headers jsonb,
  created_at timestamptz default now()
);

create table if not exists recon_inputs (
  id bigserial primary key,
  tenant_id text not null,
  tax_type text not null,
  period_id text not null,
  payroll_snapshot jsonb,
  pos_snapshot jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_recon_inputs_period on recon_inputs(tenant_id, tax_type, period_id, created_at desc);

create table if not exists recon_results (
  id bigserial primary key,
  tenant_id text not null,
  tax_type text not null,
  period_id text not null,
  status text not null,
  deltas jsonb not null,
  reasons jsonb not null,
  created_at timestamptz default now()
);

create index if not exists idx_recon_results_period on recon_results(tenant_id, tax_type, period_id, created_at desc);

create table if not exists event_outbox (
  id bigserial primary key,
  topic text not null,
  payload jsonb not null,
  created_at timestamptz default now(),
  published_at timestamptz
);

create table if not exists gate_transitions (
  id bigserial primary key,
  tenant_id text not null,
  tax_type text not null,
  period_id text not null,
  previous_state text,
  next_state text,
  reason_codes text[],
  created_at timestamptz default now()
);

create index if not exists idx_gate_transitions_period on gate_transitions(tenant_id, tax_type, period_id, created_at desc);
