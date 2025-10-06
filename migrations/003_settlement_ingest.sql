-- 003_settlement_ingest.sql
create table if not exists settlement_files (
  id bigserial primary key,
  file_id text,
  schema_version text,
  generated_at timestamptz,
  received_at timestamptz not null default now(),
  signer_key_id text,
  signature_verified boolean,
  hmac_key_id text,
  hmac_verified boolean,
  csv_sha256 text,
  row_count integer,
  status text not null,
  error_code text,
  error_detail jsonb,
  raw_payload jsonb not null,
  verification_artifacts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_settlement_files_received_at on settlement_files(received_at desc);
create index if not exists idx_settlement_files_status on settlement_files(status);
create unique index if not exists uq_settlement_files_file_id_success on settlement_files(file_id) where status = 'ACCEPTED';
