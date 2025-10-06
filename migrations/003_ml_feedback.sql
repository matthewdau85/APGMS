-- 003_ml_feedback.sql
-- Capture operator ML decisions and track model versions for feedback loops

create table if not exists ml_decisions (
  id bigserial primary key,
  created_at timestamptz default now(),
  user_id_hash text not null,
  action text not null,
  input_hash text not null,
  suggested jsonb not null,
  chosen jsonb not null,
  accepted boolean not null,
  latency_ms integer not null check (latency_ms >= 0),
  model_version text generated always as ((suggested ->> 'model_version')) stored
);

create index if not exists idx_ml_decisions_model_version on ml_decisions(model_version);
create index if not exists idx_ml_decisions_created_at on ml_decisions(created_at);

create table if not exists ml_model_versions (
  version text primary key,
  created_at timestamptz default now(),
  parent_version text,
  last_decision_id bigint default 0,
  decision_count bigint not null default 0,
  accepted_count bigint not null default 0,
  metrics jsonb default '{}'::jsonb,
  is_active boolean not null default false
);

create unique index if not exists uniq_ml_model_active on ml_model_versions((is_active)) where is_active;
