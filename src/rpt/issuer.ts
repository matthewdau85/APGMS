import { Pool } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { isAnomalous } from "../anomaly/deterministic";
import { enqueuePendingAnomaly } from "../anomaly/pendingQueue";

const pool = new Pool();
const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");
const PROTO_BLOCK_ON_ANOMALY = String(process.env.PROTO_BLOCK_ON_ANOMALY || "false").toLowerCase() === "true";

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number> = {}
) {
  const p = await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
  if (p.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const effectiveThresholds = { ...thresholds } as Record<string, unknown>;
  const epsilonLimit = Number(effectiveThresholds["epsilon_cents"] ?? 0);
  const sigmaCandidate = effectiveThresholds["sigma"];
  const sigmaThreshold = Number.isFinite(Number(sigmaCandidate)) ? Number(sigmaCandidate) : undefined;
  const materialityCents = Math.max(Number(effectiveThresholds["materiality_cents"] ?? 500), 500);
  const baselineCandidate = effectiveThresholds["baseline_cents"];
  const baselineParsed = Number(baselineCandidate);
  const baselineCents = Number.isFinite(baselineParsed)
    ? baselineParsed
    : Number(row.accrued_cents ?? row.final_liability_cents ?? 0);

  const totalCents = Number(row.final_liability_cents ?? 0);
  const anomalyEvaluation = isAnomalous.evaluate(totalCents, baselineCents, sigmaThreshold, materialityCents);
  if (anomalyEvaluation.flagged) {
    const entry = enqueuePendingAnomaly({
      abn,
      taxType,
      periodId,
      observedCents: totalCents,
      baselineCents,
      sigmaThreshold: anomalyEvaluation.sigmaThreshold,
      materialityCents: anomalyEvaluation.materialityThreshold,
      zScore: anomalyEvaluation.zScore,
      deviationCents: anomalyEvaluation.deviation,
      note: "Auto-detected variance",
      provenance: "issueRPT"
    });

    if (PROTO_BLOCK_ON_ANOMALY) {
      await pool.query("update periods set state='BLOCKED_ANOMALY' where id=", [row.id]);
      throw new Error("BLOCKED_ANOMALY");
    }

    console.warn(
      `[anomaly] ${abn}/${taxType}/${periodId} pending review; z=${anomalyEvaluation.zScore.toFixed(2)} Δ=${anomalyEvaluation.deviation}¢ (#${entry.id})`
    );
  }

  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > epsilonLimit) {
    await pool.query("update periods set state='BLOCKED_DISCREPANCY' where id=", [row.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const thresholdsPayload: Record<string, number> = {
    epsilon_cents: epsilonLimit,
    sigma: anomalyEvaluation.sigmaThreshold,
    materiality_cents: anomalyEvaluation.materialityThreshold,
    baseline_cents: baselineCents
  };
  for (const [key, value] of Object.entries(effectiveThresholds)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      thresholdsPayload[key] = parsed;
    }
  }

  const payload: RptPayload = {
    entity_id: row.abn,
    period_id: row.period_id,
    tax_type: row.tax_type,
    amount_cents: totalCents,
    merkle_root: row.merkle_root,
    running_balance_hash: row.running_balance_hash,
    anomaly_vector: {
      baseline_cents: baselineCents,
      observed_cents: totalCents,
      deviation_cents: anomalyEvaluation.deviation,
      z_score: Number(anomalyEvaluation.zScore.toFixed(4))
    },
    thresholds: thresholdsPayload,
    rail_id: "EFT",
    reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID()
  };
  const signature = signRpt(payload, new Uint8Array(secretKey));
  await pool.query("insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values (,,,,)",
    [abn, taxType, periodId, payload, signature]);
  await pool.query("update periods set state='READY_RPT' where id=", [row.id]);
  return { payload, signature };
}
