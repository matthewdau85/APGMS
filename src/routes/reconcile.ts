import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";
import { ReconState, assertCanTransition } from "../recon/stateMachine";

const pool = new Pool();

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  // TODO: set state -> RECONCILING, compute final_liability_cents, merkle_root, running_balance_hash beforehand
  const thr =
    thresholds ||
    { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    const message = e?.message || "UNKNOWN";
    const status = message.startsWith("BAD_STATE") || message.startsWith("BLOCKED") ? 409 : 400;
    return res.status(status).json({ error: message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    const existing = await pool.query(
      "select id, state from periods where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
    const row = existing.rows[0];
    const currentState = row.state as ReconState;
    assertCanTransition(currentState, ReconState.RELEASED);
    await pool.query("update periods set state=$1 where id=$2", [ReconState.RELEASED, row.id]);
    return res.json(r);
  } catch (e: any) {
    const message = e?.message || "UNKNOWN";
    const status = message.includes("Illegal recon state") ? 409 : 400;
    return res.status(status).json({ error: message });
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
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
