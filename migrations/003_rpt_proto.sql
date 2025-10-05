-- 003_rpt_proto.sql
-- Enable RPT v0.1 supporting anti-replay and key management

create table if not exists rpt_jti (
  jti text primary key,
  exp timestamptz not null,
  created_at timestamptz default now()
);

alter table rpt_tokens
  add column if not exists rpt_id text,
  add column if not exists kid text,
  add column if not exists nonce text,
  add column if not exists jws text,
  add column if not exists expires_at timestamptz;

create unique index if not exists idx_rpt_tokens_rpt_id on rpt_tokens(rpt_id);
