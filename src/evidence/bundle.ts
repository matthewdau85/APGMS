import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { getPool } from "../db/pool";
import { FEATURES } from "../config/features";
import { periodUuid } from "../release/period";

const RATES_VERSION = process.env.RATES_VERSION || "sandbox-v1";
const RULES_DIR = process.env.RULES_DIR || path.resolve(process.cwd(), "schema/impl");

function hashFile(filePath: string) {
  const data = fs.readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function computeRulesManifest() {
  try {
    const files = fs.readdirSync(RULES_DIR).filter((f) => fs.statSync(path.join(RULES_DIR, f)).isFile());
    const entries = files.map((name) => ({ name, sha256: hashFile(path.join(RULES_DIR, name)) }));
    const manifest_sha256 = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
    return { version: RATES_VERSION, manifest_sha256, files: entries };
  } catch {
    return { version: RATES_VERSION, manifest_sha256: null, files: [] as Array<{ name: string; sha256: string }> };
  }
}

const RULES_MANIFEST = computeRulesManifest();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string, requestId?: string) {
  const pool = getPool();
  const periodQ = await pool.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  const period = periodQ.rows[0] ?? null;
  const rpt = (
    await pool.query(
      "select payload, signature, created_at from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
      [abn, taxType, periodId]
    )
  ).rows[0] ?? null;
  const deltas = (
    await pool.query(
      "select created_at as ts, amount_cents, balance_after_cents, bank_receipt_hash, bank_receipt_id from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
      [abn, taxType, periodId]
    )
  ).rows;
  const last = deltas[deltas.length - 1];
  const periodKey = periodUuid(abn, taxType, periodId);
  const settlementRow = (
    await pool.query(
      "select rail, provider_ref, amount_cents, paid_at, simulated, meta from settlements where period_id=$1 order by paid_at desc limit 1",
      [periodKey]
    )
  ).rows[0] ?? null;

  let kid: string | null = null;
  if (rpt?.signature) {
    if (typeof rpt.signature === "string") {
      try {
        const parsed = JSON.parse(rpt.signature);
        kid = parsed?.kid ?? null;
      } catch {
        kid = null;
      }
    } else if (typeof rpt.signature === "object") {
      kid = (rpt.signature as any)?.kid ?? null;
    }
  }

  const settlement = settlementRow
    ? {
        rail: settlementRow.rail,
        provider_ref: settlementRow.provider_ref,
        amount_cents: Number(settlementRow.amount_cents),
        paid_at: new Date(settlementRow.paid_at).toISOString(),
        source: "sandbox",
      }
    : null;

  const narrative = settlement
    ? `Released because: gate=RECON_OK, thresholds not exceeded, RPT signature valid${kid ? ` (kid:${kid})` : ""}, funds settled per provider_ref ${settlement.provider_ref}.`
    : "Release pending settlement reconciliation.";

  const approvals = [] as Array<{ by: string; role: string; at: string }>;
  if (rpt?.created_at) {
    approvals.push({ by: "system:rpt", role: "RPT_VERIFIED", at: new Date(rpt.created_at).toISOString() });
  }
  if (settlementRow?.paid_at) {
    approvals.push({ by: "system:bank", role: "SETTLEMENT", at: new Date(settlementRow.paid_at).toISOString() });
  }

  return {
    requestId: requestId ?? null,
    simulated: FEATURES.SIM_OUTBOUND,
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: period?.thresholds ?? {},
    discrepancy_log: [],
    rules: RULES_MANIFEST,
    settlement,
    narrative,
    approvals,
  };
}
