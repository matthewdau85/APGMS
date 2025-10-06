-- 003_ops_tools.sql
-- Operational tooling: DLQ, activity feed, approvals queue

create table if not exists ops_dlq (
  id bigserial primary key,
  source text not null,
  payload jsonb not null,
  error text not null,
  last_error text,
  replay_count integer not null default 0,
  created_at timestamptz default now(),
  replayed_at timestamptz
);

create index if not exists idx_ops_dlq_created_at on ops_dlq(created_at desc);

create table if not exists ops_activity (
  id bigserial primary key,
  ts timestamptz default now(),
  actor text not null,
  type text not null,
  status text not null,
  detail jsonb not null
);

create index if not exists idx_ops_activity_ts on ops_activity(ts desc);

create table if not exists ops_approvals (
  id bigserial primary key,
  created_at timestamptz default now(),
  decided_at timestamptz,
  decided_by text,
  status text not null default 'PENDING',
  abn text not null,
  tax_type text not null,
  period_id text not null,
  amount_cents bigint not null,
  requester text not null,
  memo text,
  comment text
);

create index if not exists idx_ops_approvals_status on ops_approvals(status, created_at desc);

-- demo seed so UI has something to render (idempotent)
insert into ops_approvals(abn,tax_type,period_id,amount_cents,requester,memo)
select '12345678901','PAYGW','2025-Q1',120000,'Finance','PAYGW true-up before BAS cut-off'
where not exists (
  select 1 from ops_approvals where abn='12345678901' and tax_type='PAYGW' and period_id='2025-Q1' and status='PENDING'
);

insert into ops_approvals(abn,tax_type,period_id,amount_cents,requester,memo)
select '12345678901','GST','2025-Q1',45000,'Compliance','GST liability adjustment after recon'
where not exists (
  select 1 from ops_approvals where abn='12345678901' and tax_type='GST' and period_id='2025-Q1' and status='PENDING'
);
