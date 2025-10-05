-- 003_rates_version.sql

CREATE TABLE IF NOT EXISTS rates_version (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  checksum_sha256 CHAR(64) NOT NULL,
  penalty_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paygw_brackets (
  id SERIAL PRIMARY KEY,
  version_id UUID NOT NULL REFERENCES rates_version(id) ON DELETE CASCADE,
  min_cents BIGINT NOT NULL,
  max_cents BIGINT,
  base_tax_cents BIGINT NOT NULL,
  rate_basis_points INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS paygw_brackets_version_min_idx
  ON paygw_brackets(version_id, min_cents);

CREATE TABLE IF NOT EXISTS gst_version (
  version_id UUID PRIMARY KEY REFERENCES rates_version(id) ON DELETE CASCADE,
  rate_basis_points INTEGER NOT NULL
);

ALTER TABLE periods
  ADD COLUMN IF NOT EXISTS rates_version_id UUID REFERENCES rates_version(id);
