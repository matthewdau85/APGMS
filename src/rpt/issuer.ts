import { Pool } from "pg";
import crypto from "crypto";
import nacl from "tweetnacl";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { isAnomalous } from "../anomaly/deterministic";
import { merkleRootHex } from "../crypto/merkle";

const pool = new Pool();

let cachedSecretKey: Uint8Array | null = null;

function getSecretKey(): Uint8Array {
  if (cachedSecretKey) {
    return cachedSecretKey;
  }
  const env = process.env.RPT_ED25519_SECRET_BASE64;
  if (env) {
    cachedSecretKey = new Uint8Array(Buffer.from(env, "base64"));
    return cachedSecretKey;
  }
  const generated = nacl.sign.keyPair();
  cachedSecretKey = generated.secretKey;
  console.warn("[issuer] RPT_ED25519_SECRET_BASE64 not set; using ephemeral key");
  return cachedSecretKey;
}

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>
) {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");

    const periodRes = await client.query(
      `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 FOR UPDATE`,
      [abn, taxType, periodId]
    );
    if (periodRes.rowCount === 0) {
      throw new Error("PERIOD_NOT_FOUND");
    }
    const period = periodRes.rows[0];
    if (period.state !== "CLOSING") {
      throw new Error("BAD_STATE");
    }

    const anomalyVector = period.anomaly_vector ?? {};
    const storedThresholds = period.thresholds ?? {};
    const effectiveThresholds = { ...storedThresholds, ...thresholds } as Record<string, number>;

    if (isAnomalous(anomalyVector, effectiveThresholds)) {
      await client.query(`UPDATE periods SET state='BLOCKED_ANOMALY' WHERE id=$1`, [period.id]);
      await client.query("COMMIT");
      committed = true;
      throw new Error("BLOCKED_ANOMALY");
    }

    const credited = Number(period.credited_to_owa_cents ?? 0);
    const liability = Number(period.final_liability_cents ?? credited);
    const epsilonLimit = Number(effectiveThresholds["epsilon_cents"] ?? 0);
    if (Math.abs(liability - credited) > epsilonLimit) {
      await client.query(`UPDATE periods SET state='BLOCKED_DISCREPANCY' WHERE id=$1`, [period.id]);
      await client.query("COMMIT");
      committed = true;
      throw new Error("BLOCKED_DISCREPANCY");
    }

    const ledgerRes = await client.query(
      `SELECT transfer_uuid, amount_cents, balance_after_cents, hash_after
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id`,
      [abn, taxType, periodId]
    );
    const ledgerRows = ledgerRes.rows;
    const merkle = period.merkle_root ?? merkleRootHex(
      ledgerRows.map((row) => `${row.transfer_uuid}:${row.amount_cents}:${row.balance_after_cents}`)
    );
    const runningHash =
      period.running_balance_hash ??
      (ledgerRows.length ? ledgerRows[ledgerRows.length - 1].hash_after ?? "" : "");

    const payload: RptPayload = {
      entity_id: period.abn,
      period_id: period.period_id,
      tax_type: period.tax_type,
      amount_cents: liability,
      merkle_root: merkle,
      running_balance_hash: runningHash,
      anomaly_vector: anomalyVector,
      thresholds: effectiveThresholds,
      rail_id: "EFT",
      reference: process.env.ATO_PRN || "ATO-PRN-DEV",
      expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      nonce: crypto.randomUUID(),
    };

    const signature = signRpt(payload, getSecretKey());

    await client.query(
      `INSERT INTO rpt_tokens(abn,tax_type,period_id,payload,signature,status)
       VALUES ($1,$2,$3,$4,$5,'ISSUED')
       ON CONFLICT (abn,tax_type,period_id)
       DO UPDATE SET
         payload = EXCLUDED.payload,
         signature = EXCLUDED.signature,
         status = 'ISSUED',
         created_at = now()`,
      [abn, taxType, periodId, payload, signature]
    );

    await client.query(
      `UPDATE periods
          SET state='READY_RPT',
              thresholds=$4::jsonb,
              merkle_root=$5,
              running_balance_hash=$6,
              final_liability_cents=$7,
              credited_to_owa_cents=$8
        WHERE id=$1`,
      [period.id, taxType, periodId, JSON.stringify(effectiveThresholds), merkle, runningHash, liability, credited]
    );

    await client.query("COMMIT");
    committed = true;
    return { payload, signature };
  } catch (err) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    throw err;
  } finally {
    client.release();
  }
}
