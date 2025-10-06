#!/usr/bin/env ts-node
import "dotenv/config";
import { Client } from "pg";
import crypto from "crypto";
import { merkleRootHex } from "../src/crypto/merkle";

const DEFAULT_ABN = process.env.SEED_ABN || "12345678901";
const DEFAULT_TAX_TYPE = process.env.SEED_TAX_TYPE || "GST";
const DEFAULT_PERIOD_ID = process.env.SEED_PERIOD_ID || "2025-10";
const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  `postgres://${process.env.PGUSER || "apgms"}:${encodeURIComponent(process.env.PGPASSWORD || "apgms_pw")}` +
    `@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "apgms"}`;

const ALLOW_LIST_RAIL: "EFT" = "EFT";

const DEFAULT_ANOMALY = {
  variance_ratio: 0.1,
  dup_rate: 0,
  gap_minutes: 10,
  delta_vs_baseline: 0.05,
};

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

const DEFAULT_BAS_LABELS: Record<string, number> = {
  W1: 2500000,
  W2: 500000,
  "1A": 275000,
  "1B": 225000,
};

const CREDIT_SERIES = [60000, 40000, 23456];

async function seed() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  const abn = DEFAULT_ABN;
  const taxType = DEFAULT_TAX_TYPE;
  const periodId = DEFAULT_PERIOD_ID;

  console.log(`[seed] Target period ${abn}/${taxType}/${periodId}`);

  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    await client.query(
      `DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    await client.query(
      `DELETE FROM bas_labels WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    await client.query(
      `DELETE FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );

    await client.query(
      `INSERT INTO periods(
         abn,tax_type,period_id,state,basis,accrued_cents,credited_to_owa_cents,final_liability_cents,
         merkle_root,running_balance_hash,anomaly_vector,thresholds
       ) VALUES ($1,$2,$3,'OPEN','ACCRUAL',0,0,0,NULL,NULL,$4,$5)`,
      [abn, taxType, periodId, DEFAULT_ANOMALY, DEFAULT_THRESHOLDS]
    );

    const receipts: string[] = [];
    let lastBalance = 0;
    let lastHash = "";
    for (const amount of CREDIT_SERIES) {
      const receipt = `rcpt:${crypto.randomUUID().slice(0, 12)}`;
      receipts.push(`${receipt}:${amount}`);
      const result = await client.query(
        `SELECT * FROM owa_append($1,$2,$3,$4,$5)`,
        [abn, taxType, periodId, amount, receipt]
      );
      lastBalance = Number(result.rows[0]?.balance_after ?? lastBalance + amount);
      lastHash = result.rows[0]?.hash_after || lastHash;
    }

    const merkleRoot = receipts.length ? merkleRootHex(receipts) : null;
    const totalCredits = CREDIT_SERIES.reduce((sum, v) => sum + v, 0);

    await client.query(
      `UPDATE periods SET
         state='CLOSING',
         accrued_cents=$4,
         credited_to_owa_cents=$4,
         final_liability_cents=$4,
         merkle_root=$5,
         running_balance_hash=$6,
         anomaly_vector=$7,
         thresholds=$8
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId, totalCredits, merkleRoot, lastHash, DEFAULT_ANOMALY, DEFAULT_THRESHOLDS]
    );

    for (const [label, cents] of Object.entries(DEFAULT_BAS_LABELS)) {
      await client.query(
        `INSERT INTO bas_labels(abn,tax_type,period_id,label,value_cents)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (abn,tax_type,period_id,label)
         DO UPDATE SET value_cents=EXCLUDED.value_cents`,
        [abn, taxType, periodId, label, cents]
      );
    }

    const reference = process.env.ATO_PRN || "1234567890";
    await client.query(
      `INSERT INTO remittance_destinations(abn,label,rail,reference,account_bsb,account_number)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (abn, rail, reference)
         DO UPDATE SET label=EXCLUDED.label, account_bsb=EXCLUDED.account_bsb, account_number=EXCLUDED.account_number`,
      [abn, `${taxType} primary`, ALLOW_LIST_RAIL, reference, "123-456", "987654321"]
    );

    await client.query("COMMIT");

    console.log(`[seed] Period primed with ${CREDIT_SERIES.length} ledger credits. Running balance: ${lastBalance}`);
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[seed] Failed", err);
    throw err;
  } finally {
    await client.end();
  }
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
