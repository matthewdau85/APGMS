-- 003_seed_support.sql
-- Support tables used by seed/smoke flows

CREATE TABLE IF NOT EXISTS bas_labels (
  id SERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  labels JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (abn, tax_type, period_id)
);

CREATE OR REPLACE FUNCTION bas_labels_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bas_labels_touch ON bas_labels;
CREATE TRIGGER bas_labels_touch
BEFORE UPDATE ON bas_labels
FOR EACH ROW EXECUTE FUNCTION bas_labels_touch();

CREATE TABLE IF NOT EXISTS recon_inputs (
  id SERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (abn, tax_type, period_id)
);

CREATE OR REPLACE FUNCTION recon_inputs_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recon_inputs_touch ON recon_inputs;
CREATE TRIGGER recon_inputs_touch
BEFORE UPDATE ON recon_inputs
FOR EACH ROW EXECUTE FUNCTION recon_inputs_touch();
