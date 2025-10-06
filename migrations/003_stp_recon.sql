-- 003_stp_recon.sql

CREATE TABLE IF NOT EXISTS recon_inputs (
  id            bigserial PRIMARY KEY,
  abn           text NOT NULL,
  tax_type      text NOT NULL,
  period_id     text NOT NULL,
  stp_event_id  text NOT NULL,
  employee_id   text NOT NULL,
  earnings_code text NOT NULL,
  w1_cents      bigint NOT NULL DEFAULT 0,
  w2_cents      bigint NOT NULL DEFAULT 0,
  special_tags  text[] NOT NULL DEFAULT '{}'::text[],
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recon_inputs_period_idx
  ON recon_inputs (abn, tax_type, period_id, stp_event_id);

