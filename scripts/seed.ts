import "dotenv/config";
import { Pool, PoolClient } from "pg";

const DEFAULT_ABN = "11122233344";
const DEFAULT_TAX_TYPE: "PAYGW" | "GST" = "GST";
const DEFAULT_PERIOD_ID = "2025-09";
const DEFAULT_FINAL_LIABILITY = 50_000;

const basLabelSeed = {
  W1: 185000,
  W2: 92500,
  "1A": 50000,
  "1B": 15000,
};

const reconSeed = {
  bank_feed: [
    { txn_id: "dep-1", amount_cents: 20000, received_at: new Date().toISOString() },
    { txn_id: "dep-2", amount_cents: 30000, received_at: new Date().toISOString() },
  ],
  erp_feed: [
    { invoice: "INV-1001", gst_collected_cents: 4200, paygw_withheld_cents: 7100 },
    { invoice: "INV-1002", gst_collected_cents: 5800, paygw_withheld_cents: 8900 },
  ],
  variance_cents: 0,
};

async function tableExists(client: PoolClient, table: string) {
  const { rows } = await client.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`public.${table}`]
  );
  return rows[0]?.exists ?? false;
}

async function truncateIfExists(client: PoolClient, table: string) {
  if (await tableExists(client, table)) {
    await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
  }
}

async function seed() {
  const pool = new Pool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tables = ["recon_inputs", "bas_labels", "rpt_tokens", "owa_ledger", "periods"];
    for (const table of tables) {
      await truncateIfExists(client, table);
    }

    await client.query(
      `INSERT INTO periods
         (abn, tax_type, period_id, state, basis, accrued_cents, credited_to_owa_cents, final_liability_cents,
          merkle_root, running_balance_hash, anomaly_vector, thresholds)
       VALUES ($1,$2,$3,'CLOSING','ACCRUAL',$4,0,$5,$6,$7,$8,$9)
       ON CONFLICT (abn, tax_type, period_id) DO UPDATE SET
         state=EXCLUDED.state,
         basis=EXCLUDED.basis,
         accrued_cents=EXCLUDED.accrued_cents,
         credited_to_owa_cents=EXCLUDED.credited_to_owa_cents,
         final_liability_cents=EXCLUDED.final_liability_cents,
         merkle_root=EXCLUDED.merkle_root,
         running_balance_hash=EXCLUDED.running_balance_hash,
         anomaly_vector=EXCLUDED.anomaly_vector,
         thresholds=EXCLUDED.thresholds`,
      [
        DEFAULT_ABN,
        DEFAULT_TAX_TYPE,
        DEFAULT_PERIOD_ID,
        DEFAULT_FINAL_LIABILITY,
        DEFAULT_FINAL_LIABILITY,
        "seed_merkle_root",
        "seed_balance_hash",
        { variance_ratio: 0.1, dup_rate: 0.01, gap_minutes: 10, delta_vs_baseline: 0.05 },
        { epsilon_cents: 100, variance_ratio: 0.25, dup_rate: 0.02, gap_minutes: 60, delta_vs_baseline: 0.2 },
      ]
    );

    if (await tableExists(client, "bas_labels")) {
      await client.query(
        `INSERT INTO bas_labels (abn, tax_type, period_id, labels)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (abn, tax_type, period_id) DO UPDATE SET labels=EXCLUDED.labels`,
        [DEFAULT_ABN, DEFAULT_TAX_TYPE, DEFAULT_PERIOD_ID, basLabelSeed]
      );
    }

    if (await tableExists(client, "recon_inputs")) {
      await client.query(
        `INSERT INTO recon_inputs (abn, tax_type, period_id, payload)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (abn, tax_type, period_id) DO UPDATE SET payload=EXCLUDED.payload,
                                                         updated_at=now()`,
        [DEFAULT_ABN, DEFAULT_TAX_TYPE, DEFAULT_PERIOD_ID, reconSeed]
      );
    }

    await client.query("COMMIT");
    console.log(`Seeded period ${DEFAULT_PERIOD_ID} for ABN ${DEFAULT_ABN}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Seed failed", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
