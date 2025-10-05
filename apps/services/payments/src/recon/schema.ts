import type { PoolClient } from "pg";

let ensured = false;

export async function ensureBankReconSchema(client: PoolClient) {
  if (ensured) return;

  await client.query(`
    CREATE TABLE IF NOT EXISTS payout_releases (
      release_uuid        UUID PRIMARY KEY,
      rpt_id              BIGINT      NOT NULL UNIQUE,
      abn                 TEXT        NOT NULL,
      tax_type            TEXT        NOT NULL,
      period_id           TEXT        NOT NULL,
      amount_cents        BIGINT      NOT NULL,
      reference           TEXT        NOT NULL,
      ledger_entry_id     BIGINT,
      bank_receipt_id     TEXT,
      matched_bank_txn_id TEXT,
      match_strategy      TEXT,
      matched_at          TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_payout_releases_rpt_id
      ON payout_releases (rpt_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_payout_releases_period
      ON payout_releases (abn, tax_type, period_id)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS bank_statement_lines (
      bank_txn_id          TEXT PRIMARY KEY,
      abn                  TEXT        NOT NULL,
      tax_type             TEXT,
      period_id            TEXT,
      statement_date       DATE        NOT NULL,
      amount_cents         BIGINT      NOT NULL,
      reference            TEXT        NOT NULL,
      status               TEXT        NOT NULL DEFAULT 'UNRESOLVED',
      match_strategy       TEXT,
      matched_release_uuid UUID,
      matched_at           TIMESTAMPTZ,
      raw_payload          JSONB,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_bank_lines_status
      ON bank_statement_lines (abn, status)
  `);

  ensured = true;
}
