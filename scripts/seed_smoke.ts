import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { sha256Hex } from "../src/crypto/merkle";

const abn = process.env.SMOKE_ABN ?? "12345678901";
const taxType = process.env.SMOKE_TAX_TYPE ?? "GST";
const periodId = process.env.SMOKE_PERIOD_ID ?? "2025-10";
const allowRail = process.env.SMOKE_RAIL ?? "EFT";
const allowReference = process.env.SMOKE_REFERENCE ?? "SMOKE-PRN";

const credits = (process.env.SMOKE_CREDITS ?? "60000,40000,23456")
  .split(",")
  .map((v) => Number(v.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not set");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3`, [abn, taxType, periodId]);
    await client.query(`DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3`, [abn, taxType, periodId]);
    await client.query(`DELETE FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`, [abn, taxType, periodId]);

    let prevHash = "";
    let balance = 0;
    for (const amount of credits) {
      balance += amount;
      const transferUuid = randomUUID();
      const bankHash = `seed:${transferUuid.slice(0, 12)}`;
      const hashAfter = sha256Hex(prevHash + bankHash + String(balance));
      await client.query(
        `INSERT INTO owa_ledger(
           abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
        [abn, taxType, periodId, transferUuid, amount, balance, bankHash, prevHash, hashAfter]
      );
      prevHash = hashAfter;
    }

    await client.query(
      `INSERT INTO periods(
         abn,tax_type,period_id,state,basis,accrued_cents,credited_to_owa_cents,final_liability_cents,
         merkle_root,running_balance_hash,anomaly_vector,thresholds)
       VALUES ($1,$2,$3,'OPEN','ACCRUAL',0,$4,$4,NULL,$5,'{}',$6::jsonb)
       ON CONFLICT (abn,tax_type,period_id)
       DO UPDATE SET
         state='OPEN',
         credited_to_owa_cents=$4,
         final_liability_cents=$4,
         running_balance_hash=$5,
         thresholds=$6::jsonb`,
      [abn, taxType, periodId, balance, prevHash, JSON.stringify(DEFAULT_THRESHOLDS)]
    );

    await client.query(
      `INSERT INTO remittance_destinations(abn,label,rail,reference,account_bsb,account_number)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (abn, rail, reference)
       DO UPDATE SET label=EXCLUDED.label, account_bsb=EXCLUDED.account_bsb, account_number=EXCLUDED.account_number`,
      [abn, `${allowRail} primary`, allowRail, allowReference, "123-456", "987654321"]
    );

    await client.query("COMMIT");
    console.log(`[seed] period ${abn}/${taxType}/${periodId} ready`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[seed] failed", err);
  process.exitCode = 1;
});
