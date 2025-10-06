import "dotenv/config";
import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";

const DEMO_ABN = process.env.SEED_ABN ?? "12345678901";
const DEMO_TAX = process.env.SEED_TAX_TYPE ?? "GST";
const DEMO_PERIOD = process.env.SEED_PERIOD ?? "2025-09";

const connectionString =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || "apgms"}:${encodeURIComponent(
    process.env.PGPASSWORD || "apgms_pw"
  )}@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${
    process.env.PGDATABASE || "apgms"
  }`;

const pool = new Pool({ connectionString });

type Credit = { amount: number; receipt: string };

function hashSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function merkleLikeRoot(credits: Credit[]): string {
  const leaves = credits.map((c) => hashSha256(`${c.receipt}:${c.amount}`));
  if (leaves.length === 0) {
    return hashSha256("");
  }
  let layer = leaves;
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left;
      next.push(hashSha256(left + right));
    }
    layer = next;
  }
  return layer[0];
}

async function main() {
  const client = await pool.connect();
  const ledgerCredits: number[] = [50_000, 40_000, 33_456];
  const anomalyVector = {
    variance_ratio: 0.1,
    dup_rate: 0.0,
    gap_minutes: 10,
    delta_vs_baseline: 0.05,
  };
  const thresholds = {
    epsilon_cents: 0,
    variance_ratio: 0.25,
    dup_rate: 0.01,
    gap_minutes: 60,
    delta_vs_baseline: 0.2,
    rates_version: process.env.SEED_RATES_VERSION ?? "demo-2025-09",
  };

  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM evidence_bundles WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [DEMO_ABN, DEMO_TAX, DEMO_PERIOD]
    );
    await client.query(
      `DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [DEMO_ABN, DEMO_TAX, DEMO_PERIOD]
    );
    await client.query(
      `DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [DEMO_ABN, DEMO_TAX, DEMO_PERIOD]
    );

    await client.query(
      `INSERT INTO remittance_destinations (abn,label,rail,reference,account_bsb,account_number)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (abn, rail, reference)
       DO UPDATE SET label=EXCLUDED.label, account_bsb=EXCLUDED.account_bsb, account_number=EXCLUDED.account_number`,
      [
        DEMO_ABN,
        "ATO_EFT",
        "EFT",
        process.env.SEED_EFT_REFERENCE ?? "1234567890",
        process.env.SEED_EFT_BSB ?? "092-009",
        process.env.SEED_EFT_ACCOUNT ?? "12345678",
      ]
    );

    await client.query(
      `INSERT INTO remittance_destinations (abn,label,rail,reference)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (abn, rail, reference)
       DO UPDATE SET label=EXCLUDED.label`,
      [
        DEMO_ABN,
        "ATO_BPAY",
        "BPAY",
        process.env.SEED_BPAY_REFERENCE ?? "987654321",
      ]
    );

    await client.query(
      `INSERT INTO periods (
         abn,tax_type,period_id,state,basis,
         accrued_cents,credited_to_owa_cents,final_liability_cents,
         merkle_root,running_balance_hash,anomaly_vector,thresholds
       ) VALUES ($1,$2,$3,'OPEN','ACCRUAL',0,0,0,$4,$5,$6::jsonb,$7::jsonb)
       ON CONFLICT (abn,tax_type,period_id)
       DO UPDATE SET
         state='OPEN',
         basis='ACCRUAL',
         accrued_cents=0,
         credited_to_owa_cents=0,
         final_liability_cents=0,
         merkle_root=EXCLUDED.merkle_root,
         running_balance_hash=EXCLUDED.running_balance_hash,
         anomaly_vector=EXCLUDED.anomaly_vector,
         thresholds=EXCLUDED.thresholds`,
      [DEMO_ABN, DEMO_TAX, DEMO_PERIOD, "", "", JSON.stringify(anomalyVector), JSON.stringify(thresholds)]
    );

    let balance = 0;
    let prevHash = "";
    const credits: Credit[] = [];

    for (const [idx, amount] of ledgerCredits.entries()) {
      balance += amount;
      const receipt = `rcpt:${idx + 1}:${DEMO_PERIOD}`;
      const hashAfter = hashSha256(`${prevHash}|${receipt}|${balance}`);
      credits.push({ amount, receipt });

      await client.query(
        `INSERT INTO owa_ledger (
           abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,
           bank_receipt_hash,prev_hash,hash_after,created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
        [
          DEMO_ABN,
          DEMO_TAX,
          DEMO_PERIOD,
          randomUUID(),
          amount,
          balance,
          receipt,
          prevHash || null,
          hashAfter,
        ]
      );

      prevHash = hashAfter;
    }

    const total = balance;
    const merkleRoot = merkleLikeRoot(credits);

    await client.query(
      `UPDATE periods
         SET accrued_cents=$4,
             credited_to_owa_cents=$4,
             final_liability_cents=$4,
             merkle_root=$5,
             running_balance_hash=$6
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [DEMO_ABN, DEMO_TAX, DEMO_PERIOD, total, merkleRoot, prevHash]
    );

    await client.query("COMMIT");
    console.log(
      `[seed] Demo data ready for ${DEMO_ABN} ${DEMO_TAX} ${DEMO_PERIOD} (balance cents=${total})`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[seed] Failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[seed] Unexpected error:", err);
  process.exitCode = 1;
});
