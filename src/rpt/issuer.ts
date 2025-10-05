import { Pool } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds, AnomalyVector } from "../anomaly/deterministic";

type Queryable = {
  query: (sql: string, params: unknown[]) => Promise<any>;
};

let pool: Queryable = new Pool();
const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

export function __setPool(testPool: Queryable) {
  pool = testPool;
}

export function __resetPool() {
  pool = new Pool();
}

function normalizeVector(raw: Partial<AnomalyVector> = {}): Record<string, number> {
  return {
    variance_ratio: typeof raw.variance_ratio === "number" ? raw.variance_ratio : 0,
    dup_rate: typeof raw.dup_rate === "number" ? raw.dup_rate : 0,
    gap_minutes: typeof raw.gap_minutes === "number" ? raw.gap_minutes : 0,
    delta_vs_baseline: typeof raw.delta_vs_baseline === "number" ? raw.delta_vs_baseline : 0,
  };
}

export async function issueRPT(abn: string, taxType: "PAYGW"|"GST", periodId: string, thresholds: Record<string, number>) {
  const p = await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
  if (p.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const rawVector = (row.anomaly_vector || {}) as Partial<AnomalyVector>;
  const vector = normalizeVector(rawVector);
  if (exceeds(rawVector, thresholds)) {
    await pool.query("update periods set state='BLOCKED_ANOMALY' where id=", [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query("update periods set state='BLOCKED_DISCREPANCY' where id=", [row.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const payload: RptPayload = {
    entity_id: row.abn, period_id: row.period_id, tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root, running_balance_hash: row.running_balance_hash,
    anomaly_vector: vector, thresholds, rail_id: "EFT", reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15*60*1000).toISOString(), nonce: crypto.randomUUID()
  };
  const signature = signRpt(payload, new Uint8Array(secretKey));
  await pool.query("insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values (,,,,)",
    [abn, taxType, periodId, payload, signature]);
  await pool.query("update periods set state='READY_RPT' where id=", [row.id]);
  return { payload, signature };
}
