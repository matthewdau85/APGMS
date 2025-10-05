import { Pool } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";
const pool = new Pool();
const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

async function resolveRatesVersion(periodRow: any): Promise<{ id: string; checksum: string }> {
  if (periodRow.rates_version_id) {
    const existing = await pool.query(
      "select id, checksum_sha256 from rates_version where id=$1",
      [periodRow.rates_version_id]
    );
    if (existing.rowCount === 0) {
      throw new Error("RATES_VERSION_NOT_FOUND");
    }
    return { id: existing.rows[0].id, checksum: existing.rows[0].checksum_sha256 };
  }
  const latest = await pool.query(
    "select id, checksum_sha256 from rates_version order by effective_from desc limit 1"
  );
  if (latest.rowCount === 0) {
    throw new Error("NO_RATES_VERSION");
  }
  const { id, checksum_sha256 } = latest.rows[0];
  await pool.query("update periods set rates_version_id=$1 where id=$2", [id, periodRow.id]);
  return { id, checksum: checksum_sha256 };
}

export async function issueRPT(abn: string, taxType: "PAYGW"|"GST", periodId: string, thresholds: Record<string, number>) {
  const p = await pool.query("select * from periods where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId]);
  if (p.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const v = row.anomaly_vector || {};
  if (exceeds(v, thresholds)) {
    await pool.query("update periods set state='BLOCKED_ANOMALY' where id=$1", [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query("update periods set state='BLOCKED_DISCREPANCY' where id=$1", [row.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const { id: ratesVersionId, checksum } = await resolveRatesVersion(row);

  const payload: RptPayload = {
    entity_id: row.abn, period_id: row.period_id, tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root, running_balance_hash: row.running_balance_hash,
    anomaly_vector: v, thresholds, rail_id: "EFT", reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15*60*1000).toISOString(), nonce: crypto.randomUUID(),
    rates_version_id: ratesVersionId,
    rates_checksum: checksum,
  };
  const signature = signRpt(payload, new Uint8Array(secretKey));
  await pool.query("insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values ($1,$2,$3,$4,$5)",
    [abn, taxType, periodId, payload, signature]);
  await pool.query("update periods set state='READY_RPT' where id=$1", [row.id]);
  return { payload, signature };
}
