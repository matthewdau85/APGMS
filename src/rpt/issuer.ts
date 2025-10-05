import { Pool, PoolClient } from "pg";
import crypto from "crypto";
import { TextEncoder } from "util";
import { canonicalJson, sha256Hex } from "../../apps/services/payments/src/utils/crypto";
import {
  getActiveKeyId,
  signWithManagedKms,
} from "../../apps/services/payments/src/kms/kmsProvider";
import { exceeds } from "../anomaly/deterministic";

type ThresholdMap = Record<string, number>;

type PeriodRow = {
  id: number;
  abn: string;
  tax_type: "PAYGW" | "GST";
  period_id: string;
  state: string;
  anomaly_vector: Record<string, number> | null;
  final_liability_cents: string | number;
  credited_to_owa_cents: string | number;
  merkle_root: string;
  running_balance_hash: string;
};

const pool = new Pool();

function sanitizeGateBase(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

async function requestBasGateApproval(abn: string, taxType: string, periodId: string) {
  const base = sanitizeGateBase(process.env.BAS_GATE_URL || "http://localhost:8101");
  const gatePeriodId = `${abn}:${taxType}:${periodId}`;
  const resp = await globalThis.fetch(`${base}/gate/transition`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ period_id: gatePeriodId, target_state: "RPT-Issued" })
  });
  if (!resp.ok) {
    throw new Error(`BAS_GATE_ERROR_${resp.status}`);
  }
  const body: any = await resp.json().catch(() => ({}));
  if (!body?.ok) {
    throw new Error("BAS_GATE_DENIED");
  }
}

async function loadPeriod(client: PoolClient, abn: string, taxType: "PAYGW" | "GST", periodId: string): Promise<PeriodRow> {
  const q = "select * from periods where abn=$1 and tax_type=$2 and period_id=$3";
  const res = await client.query(q, [abn, taxType, periodId]);
  if (res.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  return res.rows[0] as PeriodRow;
}

function buildPayload(row: PeriodRow, thresholds: ThresholdMap, issuedAt: string, expiresAt: string, nonce: string, kid: string) {
  const anomalyVector = row.anomaly_vector || {};
  return {
    abn: row.abn,
    tax_type: row.tax_type,
    period_id: row.period_id,
    amount_cents: Number(row.final_liability_cents),
    credited_cents: Number(row.credited_to_owa_cents),
    merkle_root: row.merkle_root,
    running_balance_hash: row.running_balance_hash,
    anomaly_vector: anomalyVector,
    thresholds,
    rail_id: "EFT" as const,
    reference: process.env.ATO_PRN || "",
    issued_at: issuedAt,
    expires_at: expiresAt,
    nonce,
    kid,
  };
}

async function persistRpt(
  client: PoolClient,
  abn: string,
  taxType: string,
  periodId: string,
  payload: any,
  payloadC14n: string,
  payloadSha256: string,
  signatureB64: string,
  kid: string,
  expiresAt: string,
  nonce: string
) {
  const insertSql = `
    INSERT INTO rpt_tokens (
      abn, tax_type, period_id, payload, signature, status,
      payload_c14n, payload_sha256, kid, nonce, expires_at
    ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id
  `;
  await client.query(insertSql, [
    abn,
    taxType,
    periodId,
    JSON.stringify(payload),
    signatureB64,
    "ISSUED",
    payloadC14n,
    payloadSha256,
    kid,
    nonce,
    expiresAt,
  ]);
}

async function updatePeriodState(client: PoolClient, periodId: number, kid: string) {
  try {
    await client.query("update periods set state='READY_RPT', rpt_key_id=$1 where id=$2", [kid, periodId]);
  } catch (err: any) {
    if (err?.code === "42703") {
      await client.query("update periods set state='READY_RPT' where id=$1", [periodId]);
    } else {
      throw err;
    }
  }
}

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: ThresholdMap
) {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const row = await loadPeriod(client, abn, taxType, periodId);
    if (row.state !== "CLOSING") throw new Error("BAD_STATE");

    const anomalyVector = row.anomaly_vector || {};
    if (exceeds(anomalyVector, thresholds)) {
      await client.query("update periods set state='BLOCKED_ANOMALY' where id=$1", [row.id]);
      await client.query("COMMIT");
      committed = true;
      throw new Error("BLOCKED_ANOMALY");
    }

    const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
    if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
      await client.query("update periods set state='BLOCKED_DISCREPANCY' where id=$1", [row.id]);
      await client.query("COMMIT");
      committed = true;
      throw new Error("BLOCKED_DISCREPANCY");
    }

    await requestBasGateApproval(abn, taxType, periodId);

    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const nonce = crypto.randomUUID();
    const activeKid = getActiveKeyId();

    const payload = buildPayload(row, thresholds, issuedAt, expiresAt, nonce, activeKid);
    const payloadC14n = canonicalJson(payload);
    const payloadSha256 = sha256Hex(payloadC14n);

    const msg = new TextEncoder().encode(payloadC14n);
    const { kid, signature } = await signWithManagedKms(msg, activeKid);
    const signatureB64 = Buffer.from(signature).toString("base64");

    await persistRpt(client, abn, taxType, periodId, payload, payloadC14n, payloadSha256, signatureB64, kid, expiresAt, nonce);
    await updatePeriodState(client, row.id, kid);

    await client.query("COMMIT");
    committed = true;
    return {
      kid,
      payload,
      payload_c14n: payloadC14n,
      payload_sha256: payloadSha256,
      signature: signatureB64,
      nonce,
      expires_at: expiresAt,
    };
  } catch (err) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    throw err;
  } finally {
    client.release();
  }
}
