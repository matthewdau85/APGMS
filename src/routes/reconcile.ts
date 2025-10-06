import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { latestRpt } from "../persistence/rptRepository";
import { latestBalance } from "../services/ledgerService";
import { ensureTransition, getPeriod } from "../services/periodService";

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr =
    thresholds || {
      epsilon_cents: 50,
      variance_ratio: 0.25,
      dup_rate: 0.01,
      gap_minutes: 60,
      delta_vs_baseline: 0.2,
    };
  try {
    const period = await getPeriod(abn, taxType, periodId);
    if (!period) return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
    if (period.state === "OPEN") {
      await ensureTransition(abn, taxType, periodId, "CLOSING", "close", { reason: "issue" });
    }
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body;
  const rpt = await latestRpt(abn, taxType, periodId);
  if (!rpt) return res.status(400).json({ error: "NO_RPT" });
  try {
    await resolveDestination(abn, rail, rpt.payload.reference);
    const balance = await latestBalance(abn, taxType, periodId);
    if (balance < BigInt(rpt.payload.amount_cents)) {
      return res.status(422).json({ error: "INSUFFICIENT_OWA" });
    }
    const result = await releasePayment(
      abn,
      taxType,
      periodId,
      Number(rpt.payload.amount_cents),
      rail,
      rpt.payload.reference,
    );
    await ensureTransition(abn, taxType, periodId, "RELEASED", "release", result);
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: any, res: any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: any, res: any) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  try {
    const bundle = await buildEvidenceBundle(abn, taxType, periodId);
    res.json(bundle);
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
}
