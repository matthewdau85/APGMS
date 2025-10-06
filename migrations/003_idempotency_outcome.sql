alter table idempotency_keys
  add column if not exists status_code integer,
  add column if not exists response jsonb,
  add column if not exists request_id uuid,
  add column if not exists updated_at timestamptz default now();

update idempotency_keys set updated_at = created_at where updated_at is null;
