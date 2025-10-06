import { Client } from "pg";
import { randomUUID } from "node:crypto";

function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value && value.trim() !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var ${name}`);
}

function buildConnectionString() {
  const url = process.env.DATABASE_URL;
  if (url && url.trim() !== "") return url;
  const host = process.env.PGHOST || "127.0.0.1";
  const port = process.env.PGPORT || "5432";
  const db = process.env.PGDATABASE || "apgms";
  const user = process.env.PGUSER || "apgms";
  const password = process.env.PGPASSWORD || "";
  const encodedPassword = encodeURIComponent(password);
  return `postgres://${user}:${encodedPassword}@${host}:${port}/${db}`;
}

async function main() {
  const connectionString = buildConnectionString();
  const client = new Client({ connectionString });
  await client.connect();

  const abn = env("SIM_ABN", "12345678901");
  const taxType = env("SIM_TAX_TYPE", "GST");
  const periodId = env("SIM_PERIOD_ID", "2025-09");

  const ledgerCredits = (process.env.SIM_LEDGER_CREDITS || "50000,40000,33456")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (ledgerCredits.length === 0) throw new Error("SIM_LEDGER_CREDITS produced no positive entries");

  const merkleRoot = process.env.SIM_MERKLE_ROOT || "merkle_demo_root";
  const runningBalanceHash = process.env.SIM_RUNNING_BALANCE_HASH || "rbh_demo";
  const thresholds = {
    epsilon_cents: Number(process.env.SIM_THRESHOLD_EPSILON || 50),
    variance_ratio: Number(process.env.SIM_THRESHOLD_VARIANCE || 0.25),
    dup_rate: Number(process.env.SIM_THRESHOLD_DUP_RATE || 0.01),
    gap_minutes: Number(process.env.SIM_THRESHOLD_GAP_MINUTES || 60),
    delta_vs_baseline: Number(process.env.SIM_THRESHOLD_DELTA || 0.2),
  };
  const anomalyVector = {
    variance_ratio: Number(process.env.SIM_ANOMALY_VARIANCE || 0.1),
    dup_rate: Number(process.env.SIM_ANOMALY_DUP_RATE || 0.0),
    gap_minutes: Number(process.env.SIM_ANOMALY_GAP_MINUTES || 10),
    delta_vs_baseline: Number(process.env.SIM_ANOMALY_DELTA || 0.05),
  };

  const creditedTotal = ledgerCredits.reduce((sum, amount) => sum + amount, 0);

  console.log("Connecting to", connectionString.replace(/:[^:@]+@/, ":***@"));
  console.log(`Seeding ABN=${abn} taxType=${taxType} period=${periodId}`);

  await client.query("BEGIN");
  try {
    await client.query(
      `DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    await client.query(
      `DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );

    await client.query(
      `INSERT INTO remittance_destinations (abn,label,rail,reference,account_bsb,account_number)
       VALUES ($1,$2,'EFT',$3,$4,$5)
       ON CONFLICT (abn, rail, reference) DO UPDATE
         SET label = EXCLUDED.label,
             account_bsb = EXCLUDED.account_bsb,
             account_number = EXCLUDED.account_number`,
      [
        abn,
        process.env.SIM_EFT_LABEL || "ATO_EFT",
        process.env.SIM_EFT_REFERENCE || "1234567890",
        process.env.SIM_EFT_BSB || "092-009",
        process.env.SIM_EFT_ACCOUNT || "12345678",
      ]
    );

    await client.query(
      `INSERT INTO remittance_destinations (abn,label,rail,reference)
       VALUES ($1,$2,'BPAY',$3)
       ON CONFLICT (abn, rail, reference) DO UPDATE
         SET label = EXCLUDED.label`,
      [abn, process.env.SIM_BP_LABEL || "ATO_BPAY", process.env.SIM_BP_REFERENCE || "987654321"]
    );

    await client.query(
      `INSERT INTO periods (
         abn,tax_type,period_id,state,basis,
         accrued_cents,credited_to_owa_cents,final_liability_cents,
         merkle_root,running_balance_hash,anomaly_vector,thresholds
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (abn,tax_type,period_id) DO UPDATE SET
         state = EXCLUDED.state,
         basis = EXCLUDED.basis,
         accrued_cents = EXCLUDED.accrued_cents,
         credited_to_owa_cents = EXCLUDED.credited_to_owa_cents,
         final_liability_cents = EXCLUDED.final_liability_cents,
         merkle_root = EXCLUDED.merkle_root,
         running_balance_hash = EXCLUDED.running_balance_hash,
         anomaly_vector = EXCLUDED.anomaly_vector,
         thresholds = EXCLUDED.thresholds`,
      [
        abn,
        taxType,
        periodId,
        "CLOSING",
        process.env.SIM_BASIS || "ACCRUAL",
        creditedTotal,
        creditedTotal,
        creditedTotal,
        merkleRoot,
        runningBalanceHash,
        anomalyVector,
        thresholds,
      ]
    );

    let runningBalance = 0;
    for (const amount of ledgerCredits) {
      runningBalance += amount;
      await client.query(
        `INSERT INTO owa_ledger (
           abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,
           bank_receipt_hash,prev_hash,hash_after,created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
        [
          abn,
          taxType,
          periodId,
          randomUUID(),
          amount,
          runningBalance,
          process.env.SIM_BANK_RECEIPT_PREFIX ? `${process.env.SIM_BANK_RECEIPT_PREFIX}${randomUUID().slice(0,8)}` : `rcpt:${randomUUID().slice(0,8)}`,
          null,
          null,
        ]
      );
    }

    await client.query("COMMIT");
    console.log("Seed complete: credited cents", creditedTotal);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("seed:sim failed", err);
  process.exitCode = 1;
});
