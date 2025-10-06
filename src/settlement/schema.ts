import { Pool } from "pg";

const pool = new Pool();

const ensurePromise = (async () => {
  await pool.query(`
    create table if not exists settlements (
      provider_ref text primary key,
      abn text not null,
      tax_type text not null,
      period_id text not null,
      rail text not null,
      amount_cents bigint not null,
      paid_at timestamptz not null,
      simulated boolean default false,
      created_at timestamptz default now(),
      recon_import_id bigint,
      reconciled_at timestamptz
    )
  `);

  await pool.query(`
    create table if not exists recon_imports (
      id bigserial primary key,
      imported_at timestamptz default now(),
      source text,
      payload jsonb
    )
  `);

  await pool.query(`
    create table if not exists period_approvals (
      id bigserial primary key,
      abn text not null,
      tax_type text not null,
      period_id text not null,
      approved_by text not null,
      role text not null,
      approved_at timestamptz default now(),
      unique (abn, tax_type, period_id, role)
    )
  `);

  await pool.query(
    "alter table periods add column if not exists settlement_verified boolean default false"
  );
  await pool.query(
    "alter table periods add column if not exists settlement_provider_ref text"
  );
})();

export function ensureSettlementSchema() {
  return ensurePromise;
}
