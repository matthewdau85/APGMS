// scripts/seed.ts
import { Client } from "pg";
import { randomUUID, createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

type ConnConfig = { connectionString: string };

function loadEnvFromFile(relPath: string) {
  const abs = path.resolve(relPath);
  if (!fs.existsSync(abs)) return;
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.replace(/^\s*export\s+/, "");
    const eq = cleaned.indexOf("=");
    if (eq === -1) continue;
    const key = cleaned.slice(0, eq).trim();
    let val = cleaned.slice(eq + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    val = val.replace(/\\n/g, "\n");
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function loadRepoEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..");
  loadEnvFromFile(path.join(repoRoot, ".env.local"));
}

function buildConn(): ConnConfig {
  const url = process.env.DATABASE_URL;
  if (url) return { connectionString: url };
  const host = process.env.PGHOST || "127.0.0.1";
  const port = process.env.PGPORT || "5432";
  const user = process.env.PGUSER;
  const pass = process.env.PGPASSWORD ?? "";
  const db = process.env.PGDATABASE;
  if (!user || !db) throw new Error("PGUSER/PGDATABASE or DATABASE_URL required");
  const encPass = encodeURIComponent(pass);
  return { connectionString: `postgres://${user}:${encPass}@${host}:${port}/${db}` };
}

function canonical<T>(obj: T): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(",")}]`;
  const entries = Object.entries(obj as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

async function main() {
  loadRepoEnv();

  const abn = process.env.SEED_ABN || "12345678901";
  const taxType = process.env.SEED_TAX_TYPE || "GST";
  const periodId = process.env.SEED_PERIOD_ID || "2025-10";
  const ledgerCredit = Number(process.env.SEED_AMOUNT_CENTS || "125000");
  if (!Number.isFinite(ledgerCredit) || ledgerCredit <= 0) {
    throw new Error(`SEED_AMOUNT_CENTS must be > 0 (got ${process.env.SEED_AMOUNT_CENTS})`);
  }

  const anomalyVector = {
    variance_ratio: Number(process.env.SEED_VARIANCE_RATIO || "0.05"),
    dup_rate: Number(process.env.SEED_DUP_RATE || "0.0"),
    gap_minutes: Number(process.env.SEED_GAP_MINUTES || "5"),
    delta_vs_baseline: Number(process.env.SEED_DELTA_BASELINE || "0.01"),
  };

  const thresholds = {
    epsilon_cents: Number(process.env.SEED_EPSILON_CENTS || "0"),
    variance_ratio: Number(process.env.SEED_THRESHOLD_VARIANCE || "0.25"),
    dup_rate: Number(process.env.SEED_THRESHOLD_DUP || "0.01"),
    gap_minutes: Number(process.env.SEED_THRESHOLD_GAP || "60"),
    delta_vs_baseline: Number(process.env.SEED_THRESHOLD_DELTA || "0.2"),
  };

  const merkleRoot = process.env.SEED_MERKLE_ROOT || "seed-merkle-root";
  const runningBalanceSeed = process.env.SEED_RUNNING_HASH || "";

  const eftRef = process.env.SEED_EFT_REFERENCE || "1234567890";
  const eftBsb = process.env.SEED_EFT_BSB || "092-009";
  const eftAcct = process.env.SEED_EFT_ACCOUNT || "12345678";
  const bpayRef = process.env.SEED_BPAY_REFERENCE || "987654321";

  const client = new Client(buildConn());
  await client.connect();

  const ledgerReceipt = `seed:${randomUUID().slice(0, 12)}`;

  try {
    await client.query("BEGIN");

    await client.query(
      "DELETE FROM evidence_bundles WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    );
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

    await client.query(
      `INSERT INTO remittance_destinations (abn,label,rail,reference,account_bsb,account_number)
       VALUES ($1,'ATO_EFT','EFT',$2,$3,$4)
       ON CONFLICT (abn, rail, reference)
       DO UPDATE SET label=EXCLUDED.label, account_bsb=EXCLUDED.account_bsb, account_number=EXCLUDED.account_number`,
      [abn, eftRef, eftBsb, eftAcct]
    );
    await client.query(
      `INSERT INTO remittance_destinations (abn,label,rail,reference)
       VALUES ($1,'ATO_BPAY','BPAY',$2)
       ON CONFLICT (abn, rail, reference)
       DO UPDATE SET label=EXCLUDED.label`,
      [abn, bpayRef]
    );

    await client.query(
      `INSERT INTO periods (
         abn,tax_type,period_id,state,basis,
         accrued_cents,credited_to_owa_cents,final_liability_cents,
         merkle_root,running_balance_hash,anomaly_vector,thresholds
       ) VALUES ($1,$2,$3,'OPEN','ACCRUAL',0,0,0,$4,$5,$6::jsonb,$7::jsonb)
       ON CONFLICT (abn,tax_type,period_id)
       DO UPDATE SET basis='ACCRUAL', merkle_root=EXCLUDED.merkle_root,
         running_balance_hash=EXCLUDED.running_balance_hash,
         anomaly_vector=EXCLUDED.anomaly_vector,
         thresholds=EXCLUDED.thresholds,
         state='OPEN', accrued_cents=0, credited_to_owa_cents=0, final_liability_cents=0`,
      [abn, taxType, periodId, merkleRoot, runningBalanceSeed, canonical(anomalyVector), canonical(thresholds)]
    );

    const prev = await client.query(
      `SELECT balance_after_cents, hash_after
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC LIMIT 1`,
      [abn, taxType, periodId]
    );
    const prevBal = Number(prev.rows[0]?.balance_after_cents ?? 0);
    const prevHash = prev.rows[0]?.hash_after ?? "";
    const newBal = prevBal + ledgerCredit;
    const hashAfter = createHash("sha256")
      .update(prevHash + ledgerReceipt + String(newBal))
      .digest("hex");

    await client.query(
      `INSERT INTO owa_ledger (
         abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,
         bank_receipt_hash,prev_hash,hash_after,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
      [abn, taxType, periodId, randomUUID(), ledgerCredit, newBal, ledgerReceipt, prevHash, hashAfter]
    );

    await client.query(
      `UPDATE periods
          SET state='CLOSING',
              accrued_cents=$4,
              credited_to_owa_cents=$4,
              final_liability_cents=$4,
              running_balance_hash=$5,
              anomaly_vector=$6::jsonb,
              thresholds=$7::jsonb
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId, ledgerCredit, hashAfter, canonical(anomalyVector), canonical(thresholds)]
    );

    await client.query("COMMIT");
    console.log(
      `Seeded period ${abn}/${taxType}/${periodId} with ledger credit ${ledgerCredit} cents (receipt ${ledgerReceipt})`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});

