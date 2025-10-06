import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { debit as paytoDebit } from "../payto/adapter";
import { ingestSettlement } from "../settlement/process";
import { enqueueDlq } from "../ops/dlq";
import { recordActivity } from "../ops/activity";
import { performRailRelease, RailReleasePayload } from "../rails/release";
import { Pool } from "pg";
const pool = new Pool();

export async function closeAndIssue(req:any, res:any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  // TODO: set state -> CLOSING, compute final_liability_cents, merkle_root, running_balance_hash beforehand
  const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req:any, res:any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) {
    await recordActivity("ops", "release_attempt", "FAILED", { abn, taxType, periodId, rail, error: "NO_RPT" });
    return res.status(400).json({error:"NO_RPT"});
  }
  const payload = pr.rows[0].payload || {};
  const resolvedRail = (rail || payload.rail) as "EFT" | "BPAY" | undefined;
  if (!resolvedRail) {
    await recordActivity("ops", "release_attempt", "FAILED", { abn, taxType, periodId, error: "MISSING_RAIL" });
    return res.status(400).json({ error: "MISSING_RAIL" });
  }
  const releasePayload: RailReleasePayload = {
    abn,
    taxType,
    periodId,
    rail: resolvedRail,
    reference: payload.reference,
    amount_cents: Math.abs(Number(payload.amount_cents ?? payload.amountCents ?? 0))
  };
  try {
    const result = await performRailRelease(releasePayload);
    await recordActivity("ops", "release_attempt", "SUCCESS", {
      ...releasePayload,
      bank_receipt_hash: result?.bank_receipt_hash ?? null,
      transfer_uuid: result?.transfer_uuid ?? null
    });
    return res.json(result);
  } catch (e:any) {
    const message = e?.message || "RAIL_ERROR";
    await enqueueDlq("rail_release", releasePayload, e);
    await recordActivity("ops", "release_attempt", "FAILED", { ...releasePayload, error: message });
    return res.status(400).json({ error: message });
  }
}

export async function paytoSweep(req:any, res:any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req:any, res:any) {
  const csvText = req.body?.csv || "";
  try {
    const ingest = ingestSettlement(csvText);
    await recordActivity("ops", "recon_import", "SUCCESS", { rows: ingest.ingested });
    return res.json({ ingested: ingest.ingested });
  } catch (e:any) {
    const message = e?.message || "INVALID_CSV";
    await enqueueDlq("settlement_webhook", { csv: csvText }, e);
    await recordActivity("ops", "recon_import", "FAILED", { error: message });
    return res.status(400).json({ error: message });
  }
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
