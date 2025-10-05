create table if not exists evidence_bundles (
  id bigserial primary key,
  abn text not null,
  period_id bigint not null,
  rpt_token text,
  delta_cents bigint not null default 0,
  tolerance_bps integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ix_ev_abn_pid on evidence_bundles (abn, period_id);
