import 'dotenv/config';
import { pool } from '../src/db/pool';
import { sha256Hex } from '../src/crypto/merkle';
import { randomUUID } from 'crypto';

const ABN = process.env.SEED_ABN || '12345678901';
const TAX_TYPE: 'GST' = 'GST';
const PERIOD_ID = process.env.SEED_PERIOD_ID || '2025-09';
const RATES_VERSION = process.env.SEED_RATES_VERSION || '2024-25.v1';

async function ensureSchema() {
  await pool.query(`
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
      rates_version TEXT,
      UNIQUE (abn, tax_type, period_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS owa_ledger (
      id BIGSERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      transfer_uuid UUID NOT NULL,
      amount_cents BIGINT NOT NULL,
      balance_after_cents BIGINT NOT NULL,
      bank_receipt_hash TEXT,
      prev_hash TEXT,
      hash_after TEXT,
      bank_receipt_id BIGINT,
      rpt_verified BOOLEAN DEFAULT FALSE,
      release_uuid UUID,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (transfer_uuid)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bank_receipts (
      id BIGSERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      provider_ref TEXT NOT NULL,
      dry_run BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rpt_tokens (
      id BIGSERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      signature TEXT NOT NULL,
      payload_c14n TEXT,
      payload_sha256 TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS remittance_destinations (
      id SERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      label TEXT NOT NULL,
      rail TEXT NOT NULL,
      reference TEXT NOT NULL,
      account_bsb TEXT,
      account_number TEXT,
      UNIQUE (abn, rail, reference)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tax_period_totals (
      id BIGSERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      totals JSONB NOT NULL,
      labels JSONB NOT NULL DEFAULT '{}'::jsonb,
      rates_version TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (abn, tax_type, period_id)
    )
  `);
}

async function appendLedgerCredit(amount: number, bankReceiptHash: string) {
  const { rows } = await pool.query(
    `SELECT balance_after_cents, hash_after
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id DESC LIMIT 1`,
    [ABN, TAX_TYPE, PERIOD_ID]
  );
  const prevBal = Number(rows[0]?.balance_after_cents ?? 0);
  const prevHash = rows[0]?.hash_after ?? '';
  const newBal = prevBal + amount;
  const hashAfter = sha256Hex(prevHash + bankReceiptHash + String(newBal));

  await pool.query(
    `INSERT INTO owa_ledger(
       abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,
       bank_receipt_hash,prev_hash,hash_after,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
    [ABN, TAX_TYPE, PERIOD_ID, randomUUID(), amount, newBal, bankReceiptHash, prevHash, hashAfter]
  );
}

async function seedData() {
  await ensureSchema();

  await pool.query('DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3', [ABN, TAX_TYPE, PERIOD_ID]);
  await pool.query('DELETE FROM bank_receipts WHERE abn=$1 AND tax_type=$2 AND period_id=$3', [ABN, TAX_TYPE, PERIOD_ID]);
  await pool.query('DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3', [ABN, TAX_TYPE, PERIOD_ID]);
  await pool.query('DELETE FROM tax_period_totals WHERE abn=$1 AND tax_type=$2 AND period_id=$3', [ABN, TAX_TYPE, PERIOD_ID]);

  await pool.query(
    `INSERT INTO periods (abn,tax_type,period_id,state,credited_to_owa_cents,final_liability_cents,rates_version)
     VALUES ($1,$2,$3,'OPEN',0,0,$4)
     ON CONFLICT (abn,tax_type,period_id)
     DO UPDATE SET state='OPEN', credited_to_owa_cents=0, final_liability_cents=0, rates_version=$4`,
    [ABN, TAX_TYPE, PERIOD_ID, RATES_VERSION]
  );

  await pool.query(
    `INSERT INTO remittance_destinations (abn,label,rail,reference,account_bsb,account_number)
     VALUES ($1,$2,'EFT',$3,$4,$5)
     ON CONFLICT (abn, rail, reference) DO NOTHING`,
    [ABN, 'Seed EFT', process.env.ATO_PRN || '1234567890', '123-456', '987654321']
  );

  const deposits = [60000, 45000, 39000];
  for (const [idx, amount] of deposits.entries()) {
    await appendLedgerCredit(amount, `seed:deposit:${idx + 1}`);
  }

  const total = deposits.reduce((sum, val) => sum + val, 0);

  await pool.query(
    `UPDATE periods
        SET credited_to_owa_cents=$4,
            final_liability_cents=$4,
            merkle_root=NULL,
            running_balance_hash=NULL,
            rates_version=$5
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [ABN, TAX_TYPE, PERIOD_ID, total, RATES_VERSION]
  );

  const totals = {
    tax_type: TAX_TYPE,
    period_id: PERIOD_ID,
    final_liability_cents: total,
    credits_cents: total,
  };

  const labels = {
    W1: 'Gross wages (seed)',
    W2: 'PAYG withheld (seed)',
    '1A': 'GST on sales (seed)',
    '1B': 'GST on purchases (seed)'
  } as Record<string, string>;

  await pool.query(
    `INSERT INTO tax_period_totals (abn,tax_type,period_id,totals,labels,rates_version)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)
     ON CONFLICT (abn,tax_type,period_id)
     DO UPDATE SET totals=EXCLUDED.totals, labels=EXCLUDED.labels, rates_version=EXCLUDED.rates_version`,
    [ABN, TAX_TYPE, PERIOD_ID, totals, labels, RATES_VERSION]
  );

  console.log(`Seeded ${ABN} ${TAX_TYPE} ${PERIOD_ID} with deposits totalling ${total} cents`);
}

seedData()
  .then(() => pool.end())
  .catch(err => {
    console.error('Seed failed', err);
    pool.end().catch(() => undefined);
    process.exit(1);
  });
