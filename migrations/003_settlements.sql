create table if not exists settlements (
  provider_ref text primary key,
  abn text,
  period_id text,
  rail text,
  amount_cents bigint,
  idem_key text unique,
  paid_at timestamptz,
  receipt_json jsonb,
  verified boolean default false
);

create index if not exists idx_settlements_period on settlements(abn, period_id);
