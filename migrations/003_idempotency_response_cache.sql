-- 003_idempotency_response_cache.sql
alter table if exists idempotency_keys
  add column if not exists status_code integer,
  add column if not exists response_body jsonb;
