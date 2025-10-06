import type { Pool, PoolClient } from "pg";

async function run(client: Pool | PoolClient, sql: string) {
  await client.query(sql);
}

export async function ensureSecurityTables(client: Pool) {
  await run(
    client,
    `CREATE TABLE IF NOT EXISTS audit_log (
        id          BIGSERIAL PRIMARY KEY,
        ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
        actor_id    TEXT,
        action      TEXT NOT NULL,
        target_type TEXT,
        target_id   TEXT,
        payload     JSONB NOT NULL,
        prev_hash   TEXT,
        hash        TEXT NOT NULL
      );`
  );
  await run(
    client,
    `CREATE UNIQUE INDEX IF NOT EXISTS audit_log_hash_idx ON audit_log(hash);`
  );

  await run(
    client,
    `CREATE TABLE IF NOT EXISTS mfa_secrets (
        user_id           TEXT PRIMARY KEY,
        backend           TEXT NOT NULL,
        secret_ciphertext TEXT NOT NULL,
        secret_iv         TEXT,
        secret_tag        TEXT,
        kms_key_id        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        activated_at      TIMESTAMPTZ,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      );`
  );

  await run(
    client,
    `CREATE TABLE IF NOT EXISTS release_approvals (
        id           BIGSERIAL PRIMARY KEY,
        release_hash TEXT NOT NULL,
        payload      JSONB NOT NULL,
        actor_id     TEXT NOT NULL,
        actor_name   TEXT,
        reason       TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );`
  );
  await run(
    client,
    `CREATE UNIQUE INDEX IF NOT EXISTS release_approvals_unique ON release_approvals(release_hash, actor_id);`
  );

  await run(
    client,
    `CREATE TABLE IF NOT EXISTS payment_receipts (
        id           BIGSERIAL PRIMARY KEY,
        abn          TEXT NOT NULL,
        tax_type     TEXT NOT NULL,
        period_id    TEXT NOT NULL,
        source       TEXT NOT NULL,
        receipt_id   TEXT NOT NULL,
        payload      JSONB,
        created_by   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );`
  );
  await run(
    client,
    `CREATE INDEX IF NOT EXISTS payment_receipts_lookup ON payment_receipts(abn, tax_type, period_id, source);`
  );
}
