-- 003_ops_jobs.sql
create table if not exists ops_jobs (
  id uuid primary key,
  type text not null,
  params jsonb not null,
  status text not null check (status in ('queued','running','succeeded','failed')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  logs jsonb not null default '[]'::jsonb,
  artifacts jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  actor text not null,
  approver text,
  requires_dual boolean not null default false,
  mfa_verified_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  parent_job_id uuid
);

create index if not exists idx_ops_jobs_status on ops_jobs(status, created_at desc);
create index if not exists idx_ops_jobs_actor on ops_jobs(actor, created_at desc);
