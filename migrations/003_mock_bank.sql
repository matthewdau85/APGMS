-- Mock bank ingestion schema
create table if not exists mock_bank_batches (
  id bigserial primary key,
  source text not null default 'manual',
  raw_csv text not null,
  ingested_at timestamptz not null default now()
);

create table if not exists mock_bank_payouts (
  id bigserial primary key,
  batch_id bigint references mock_bank_batches(id) on delete set null,
  rpt_id text not null unique,
  statement_date date not null,
  posted_at timestamptz not null,
  amount_cents bigint not null,
  parts_count int not null default 1,
  status text not null default 'PENDING',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mock_bank_statement_lines (
  id bigserial primary key,
  batch_id bigint references mock_bank_batches(id) on delete cascade,
  payout_id bigint references mock_bank_payouts(id) on delete cascade,
  line_id text not null unique,
  rpt_id text not null,
  part_no int not null default 1,
  parts int not null default 1,
  amount_cents bigint not null,
  statement_date date not null,
  posted_at timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists mock_bank_payout_parts (
  id bigserial primary key,
  payout_id bigint references mock_bank_payouts(id) on delete cascade,
  part_no int not null,
  amount_cents bigint not null,
  posted_at timestamptz not null,
  statement_line_id text not null,
  created_at timestamptz not null default now(),
  unique (payout_id, part_no)
);

create index if not exists mock_bank_payouts_status_idx on mock_bank_payouts(status, posted_at);
create index if not exists mock_bank_payouts_posted_idx on mock_bank_payouts(posted_at);

create or replace function touch_mock_bank_payout_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_mock_bank_payout_touch on mock_bank_payouts;
create trigger trg_mock_bank_payout_touch
  before update on mock_bank_payouts
  for each row execute function touch_mock_bank_payout_updated_at();
