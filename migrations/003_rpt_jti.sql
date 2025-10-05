-- 003_rpt_jti.sql
CREATE TABLE IF NOT EXISTS rpt_jti (
  jti text PRIMARY KEY,
  exp timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS rpt_jti_exp_idx ON rpt_jti(exp);
