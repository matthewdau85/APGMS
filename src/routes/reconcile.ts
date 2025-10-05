import { buildEvidenceBundle } from "../evidence/bundle";
import { banking } from "../composition";
import { getPool } from "../db/pool";
import { parseSettlementCSV } from "../settlement/splitParser";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { Tx } from "../ports/banking";
import { issueRPT } from "../rpt/issuer";

const pool = getPool();

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  // TODO: set state -> CLOSING, compute final_liability_cents, merkle_root, running_balance_hash beforehand
  const thr = thresholds || {
    epsilon_cents: 50,
    variance_ratio: 0.25,
    dup_rate: 0.01,
    gap_minutes: 60,
    delta_vs_baseline: 0.2,
  };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query(
    "select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const bankTx: Tx = rail === "BPAY"
      ? await banking.bpay(abn, payload.amount_cents, payload.reference)
      : await banking.eft(abn, payload.amount_cents, payload.reference);
    const r = await releasePayment(
      abn,
      taxType,
      periodId,
      payload.amount_cents,
      rail,
      payload.reference
    );
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    return res.json({ ...r, bank_tx: bankTx });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: any, res: any) {
  const { mandateId, abn, amount_cents, amountCents, reference } = req.body || {};
  const amt = typeof amountCents === "number" ? amountCents : Number(amount_cents);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: "INVALID_AMOUNT" });
  }
  const sweepMandate = typeof mandateId === "string" && mandateId.length > 0
    ? mandateId
    : typeof abn === "string" && abn.length > 0
      ? abn
      : undefined;
  if (!sweepMandate) {
    return res.status(400).json({ error: "MANDATE_ID_REQUIRED" });
  }
  const tx = await banking.payToSweep(sweepMandate, amt, reference ?? "");
  return res.json(tx);
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
