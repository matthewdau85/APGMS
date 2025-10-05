-- 003_idempotency_settlement_queue.sql
alter table idempotency_keys
  add column if not exists updated_at timestamptz default now(),
  add column if not exists request_hash text,
  add column if not exists response_body text,
  add column if not exists response_is_json boolean default false,
  add column if not exists status_code integer;

alter table idempotency_keys
  add column if not exists response_hash text;

create table if not exists settlement_exceptions (
  id bigserial primary key,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  txn_id text not null,
  bank_reference text not null,
  reason text not null,
  status text not null default 'OPEN',
  raw_payload jsonb,
  resolved_at timestamptz,
  resolution_notes text,
  unique (txn_id, bank_reference)
);

create index if not exists idx_settlement_exceptions_status on settlement_exceptions(status);
create index if not exists idx_settlement_exceptions_txn on settlement_exceptions(txn_id);
create index if not exists idx_settlement_exceptions_bank on settlement_exceptions(bank_reference);
