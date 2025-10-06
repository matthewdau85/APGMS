import { Pool } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";
const pool = new Pool();
const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

type DestinationRow = {
  rail: "EFT"|"BPAY";
  reference: string;
  config: Record<string, any> | null;
};

function pickPreferredDestination(rows: DestinationRow[]): DestinationRow | undefined {
  if (rows.length === 0) return undefined;
  return rows.sort((a, b) => {
    const aCfg = a.config ?? {};
    const bCfg = b.config ?? {};
    const aPref = (aCfg?.preferred ?? aCfg?.default ?? false) ? 1 : 0;
    const bPref = (bCfg?.preferred ?? bCfg?.default ?? false) ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;
    return 0;
  })[0];
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

  const destinations = (
    await pool.query<DestinationRow>(
      "select rail, reference, config from remittance_destinations where abn=$1",
      [abn]
    )
  ).rows;
  const preferred = pickPreferredDestination(destinations);
  const railId = preferred?.rail ?? "EFT";
  const reference = preferred?.reference ?? (process.env.ATO_PRN || "");

  const payload: RptPayload = {
    entity_id: row.abn,
    period_id: row.period_id,
    tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root,
    running_balance_hash: row.running_balance_hash,
    anomaly_vector: v,
    thresholds,
    rail_id: railId,
    reference,
    expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID()
  };
  const signature = signRpt(payload, new Uint8Array(secretKey));
  await pool.query(
    "insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values ($1,$2,$3,$4,$5)",
    [abn, taxType, periodId, payload, signature]
  );
  await pool.query("update periods set state='READY_RPT' where id=$1", [row.id]);
  return { payload, signature };
}
