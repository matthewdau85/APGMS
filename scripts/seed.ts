import 'dotenv/config';
import { Client } from 'pg';

const {
  PGHOST = '127.0.0.1',
  PGUSER = 'apgms',
  PGPASSWORD = 'apgms_pw',
  PGDATABASE = 'apgms',
  PGPORT = '5432',
} = process.env;

const connectionOptions = {
  host: PGHOST,
  user: PGUSER,
  password: PGPASSWORD,
  database: PGDATABASE,
  port: Number(PGPORT),
};

const ABN = '11122233344';
const TAX_TYPE = 'GST';
const PERIOD_ID = '2025-09';

async function main() {
  const client = new Client(connectionOptions);
  await client.connect();

  try {
    await client.query('BEGIN');

    // Ensure helper tables exist so the seed works on a pristine database.
    await client.query(`
      CREATE TABLE IF NOT EXISTS bas_labels (
        id SERIAL PRIMARY KEY,
        abn TEXT NOT NULL,
        tax_type TEXT NOT NULL,
        period_id TEXT NOT NULL,
        label TEXT NOT NULL,
        amount_cents BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (abn, tax_type, period_id, label)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS recon_inputs (
        id SERIAL PRIMARY KEY,
        abn TEXT NOT NULL,
        tax_type TEXT NOT NULL,
        period_id TEXT NOT NULL,
        source TEXT NOT NULL,
        reference TEXT NOT NULL,
        payload JSONB NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (abn, tax_type, period_id, source, reference)
      );
    `);

    // Clean previous demo data.
    await client.query(`
      TRUNCATE TABLE
        recon_inputs,
        bas_labels,
        owa_ledger,
        rpt_tokens,
        periods,
        idempotency_keys
      RESTART IDENTITY CASCADE;
    `);

    // Seed baseline period that the smoke test exercises.
    const anomalyVector = {
      variance_ratio: 0.02,
      dup_rate: 0,
      gap_minutes: 12,
      delta_vs_baseline: 0.05,
    };
    const thresholds = {
      epsilon_cents: 50,
      variance_ratio: 0.25,
      dup_rate: 0.01,
      gap_minutes: 60,
      delta_vs_baseline: 0.2,
    };

    await client.query(
      `
      INSERT INTO periods (
        abn,
        tax_type,
        period_id,
        state,
        basis,
        accrued_cents,
        credited_to_owa_cents,
        final_liability_cents,
        merkle_root,
        running_balance_hash,
        anomaly_vector,
        thresholds
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (abn, tax_type, period_id) DO UPDATE SET
        state = EXCLUDED.state,
        basis = EXCLUDED.basis,
        accrued_cents = EXCLUDED.accrued_cents,
        credited_to_owa_cents = EXCLUDED.credited_to_owa_cents,
        final_liability_cents = EXCLUDED.final_liability_cents,
        merkle_root = EXCLUDED.merkle_root,
        running_balance_hash = EXCLUDED.running_balance_hash,
        anomaly_vector = EXCLUDED.anomaly_vector,
        thresholds = EXCLUDED.thresholds;
      `,
      [
        ABN,
        TAX_TYPE,
        PERIOD_ID,
        'CLOSING',
        'ACCRUAL',
        0,
        0,
        0,
        'demo_merkle_root',
        'demo_running_balance',
        anomalyVector,
        thresholds,
      ],
    );

    const basLabelRows: Array<[string, string, string, string, number | null]> = [
      [ABN, TAX_TYPE, PERIOD_ID, 'W1', 1850000],
      [ABN, TAX_TYPE, PERIOD_ID, 'W2', 1450000],
      [ABN, TAX_TYPE, PERIOD_ID, '1A', 185000],
      [ABN, TAX_TYPE, PERIOD_ID, '1B', 92000],
    ];

    for (const row of basLabelRows) {
      await client.query(
        `
        INSERT INTO bas_labels (abn, tax_type, period_id, label, amount_cents)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (abn, tax_type, period_id, label)
        DO UPDATE SET amount_cents = EXCLUDED.amount_cents;
        `,
        row,
      );
    }

    const reconRows = [
      {
        source: 'bank_statement',
        reference: 'stmt-2025-09-001',
        payload: {
          description: 'Corporate card sweep',
          amount_cents: 925000,
          txn_date: '2025-09-28T02:15:00.000Z',
          bank_receipt_hash: 'rcpt-bank-001',
        },
      },
      {
        source: 'erp_ledger',
        reference: 'erp-2025-09-aggregate',
        payload: {
          description: 'ERP revenue accrual snapshot',
          amount_cents: 920000,
          generated_at: '2025-09-29T11:00:00.000Z',
        },
      },
    ];

    for (const row of reconRows) {
      await client.query(
        `
        INSERT INTO recon_inputs (abn, tax_type, period_id, source, reference, payload)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (abn, tax_type, period_id, source, reference)
        DO UPDATE SET payload = EXCLUDED.payload,
                      received_at = NOW();
        `,
        [ABN, TAX_TYPE, PERIOD_ID, row.source, row.reference, row.payload],
      );
    }

    await client.query('COMMIT');
    console.log('Seed complete for period', `${ABN}/${TAX_TYPE}/${PERIOD_ID}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Seed crashed:', err);
  process.exit(1);
});
