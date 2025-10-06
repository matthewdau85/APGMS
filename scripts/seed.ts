import { Client } from "pg";
import crypto from "crypto";

function buildConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.PGUSER ?? "postgres";
  const password = encodeURIComponent(process.env.PGPASSWORD ?? "postgres");
  const host = process.env.PGHOST ?? "127.0.0.1";
  const port = process.env.PGPORT ?? "5432";
  const db = process.env.PGDATABASE ?? "apgms";
  return `postgresql://${user}:${password}@${host}:${port}/${db}`;
}

async function ensureSchema(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS periods (
      id SERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'OPEN',
      basis TEXT DEFAULT 'ACCRUAL',
      accrued_cents BIGINT DEFAULT 0,
      credited_to_owa_cents BIGINT DEFAULT 0,
      final_liability_cents BIGINT DEFAULT 0,
      merkle_root TEXT,
      running_balance_hash TEXT,
      anomaly_vector JSONB DEFAULT '{}'::jsonb,
      thresholds JSONB DEFAULT '{}'::jsonb,
      UNIQUE (abn, tax_type, period_id)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS owa_ledger (
      id BIGSERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      transfer_uuid UUID,
      amount_cents BIGINT NOT NULL,
      balance_after_cents BIGINT NOT NULL,
      bank_receipt_hash TEXT,
      prev_hash TEXT,
      hash_after TEXT,
      rpt_verified BOOLEAN NOT NULL DEFAULT FALSE,
      release_uuid UUID,
      bank_receipt_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS rpt_tokens (
      id BIGSERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      signature TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ISSUED',
      payload_c14n TEXT,
      payload_sha256 TEXT,
      nonce TEXT,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE rpt_tokens
      ADD COLUMN IF NOT EXISTS payload_c14n TEXT,
      ADD COLUMN IF NOT EXISTS payload_sha256 TEXT,
      ADD COLUMN IF NOT EXISTS nonce TEXT,
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ISSUED';
  `);

  await client.query(`
    ALTER TABLE owa_ledger
      ADD COLUMN IF NOT EXISTS rpt_verified BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS release_uuid UUID,
      ADD COLUMN IF NOT EXISTS bank_receipt_id TEXT,
      ADD COLUMN IF NOT EXISTS transfer_uuid UUID,
      ADD COLUMN IF NOT EXISTS bank_receipt_hash TEXT,
      ADD COLUMN IF NOT EXISTS prev_hash TEXT,
      ADD COLUMN IF NOT EXISTS hash_after TEXT;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS remittance_destinations (
      id SERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      label TEXT NOT NULL,
      rail TEXT NOT NULL,
      reference TEXT NOT NULL,
      account_bsb TEXT,
      account_number TEXT,
      UNIQUE (abn, rail, reference)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_status TEXT,
      response_hash TEXT
    );
  `);
}

function hashLabel(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

async function main() {
  const connectionString = buildConnectionString();
  const client = new Client({ connectionString });
  await client.connect();

  const abn = process.env.DEMO_ABN ?? "53004085616";
  const taxType = process.env.DEMO_TAX_TYPE ?? "GST";
  const periodId = process.env.DEMO_PERIOD_ID ?? "2025-09";
  const depositCents = Number(process.env.DEMO_DEPOSIT_CENTS ?? 125_00);
  const prn = process.env.ATO_PRN ?? "ATO-DEMO-PRN";

  await ensureSchema(client);

  await client.query("BEGIN");
  try {
    await client.query(
      "DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    );
    await client.query(
      "DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    );
    await client.query(
      "DELETE FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    );

    const merkle = `seed-${hashLabel(`${abn}:${periodId}:merkle`)}`;
    const runningHash = crypto.createHash("sha256").update(`|${depositCents}|${depositCents}`).digest("hex");

    await client.query(
      `INSERT INTO periods (
         abn, tax_type, period_id, state,
         accrued_cents, credited_to_owa_cents, final_liability_cents,
         merkle_root, running_balance_hash, anomaly_vector, thresholds
       ) VALUES ($1,$2,$3,'CLOSING',$4,$4,$4,$5,$6,'{}'::jsonb,'{}'::jsonb)`,
      [abn, taxType, periodId, depositCents, merkle, runningHash]
    );

    await client.query(
      `INSERT INTO remittance_destinations (abn,label,rail,reference,account_bsb,account_number)
       VALUES ($1,'Demo EFT','EFT',$2,'000000','00000000')
       ON CONFLICT (abn, rail, reference)
       DO UPDATE SET label=EXCLUDED.label, account_bsb=EXCLUDED.account_bsb, account_number=EXCLUDED.account_number`,
      [abn, prn]
    );

    await client.query("COMMIT");
    console.log("Seed complete", { abn, taxType, periodId, depositCents });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Seed failed", err);
  process.exitCode = 1;
});
