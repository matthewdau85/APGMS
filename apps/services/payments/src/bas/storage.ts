import type { Pool } from "pg";

let ensured = false;

const ensureSql = `
CREATE TABLE IF NOT EXISTS bas_period_totals (
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  domain_totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  label_totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision_seq INTEGER NOT NULL DEFAULT 0,
  carry_forward_in JSONB,
  carry_forward_out JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (abn, tax_type, period_id)
);

CREATE TABLE IF NOT EXISTS bas_revisions (
  revision_id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  revision_seq INTEGER NOT NULL,
  submitted_by TEXT,
  submitted_reason TEXT,
  evidence_ref TEXT,
  domain_totals_before JSONB NOT NULL,
  domain_totals_after JSONB NOT NULL,
  domain_delta JSONB NOT NULL,
  label_totals_before JSONB NOT NULL,
  label_totals_after JSONB NOT NULL,
  label_delta JSONB NOT NULL,
  net_before_cents BIGINT NOT NULL,
  net_after_cents BIGINT NOT NULL,
  net_delta_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (abn, tax_type, period_id, revision_seq)
);

CREATE TABLE IF NOT EXISTS evidence_addenda (
  addendum_id BIGSERIAL PRIMARY KEY,
  bundle_id BIGINT NOT NULL REFERENCES evidence_bundles(bundle_id) ON DELETE CASCADE,
  revision_id BIGINT NOT NULL REFERENCES bas_revisions(revision_id) ON DELETE CASCADE,
  addendum JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bundle_id, revision_id)
);

CREATE TABLE IF NOT EXISTS bas_carry_forward (
  carry_id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  from_period_id TEXT NOT NULL,
  to_period_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  revision_id BIGINT NOT NULL REFERENCES bas_revisions(revision_id) ON DELETE CASCADE,
  evidence_reference TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (abn, tax_type, from_period_id, to_period_id)
);
`;

export async function ensureBasTables(pool: Pool) {
  if (ensured) return;
  await pool.query(ensureSql);
  ensured = true;
}
