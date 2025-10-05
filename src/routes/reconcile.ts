import { Request, Response } from "express";
import { Pool } from "pg";
import { z } from "zod";

import { buildEvidenceBundle } from "../evidence/bundle";
import { validate } from "../http/validate";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { issueRPT } from "../rpt/issuer";
import { releasePayment, resolveDestination } from "../rails/adapter";

const pool = new Pool();

const closeAndIssueBodySchema = z.object({
  abn: z.string().min(1),
  taxType: z.string().min(1),
  periodId: z.union([z.string().min(1), z.number()]),
  thresholds: z
    .object({
      epsilon_cents: z.coerce.number().nonnegative().optional(),
      variance_ratio: z.coerce.number().nonnegative().optional(),
      dup_rate: z.coerce.number().nonnegative().optional(),
      gap_minutes: z.coerce.number().nonnegative().optional(),
      delta_vs_baseline: z.coerce.number().nonnegative().optional()
    })
    .partial()
    .optional()
});

export type CloseAndIssueBody = z.infer<typeof closeAndIssueBodySchema>;

export const closeAndIssueValidator = validate({ body: closeAndIssueBodySchema });

const defaultThresholds: NonNullable<CloseAndIssueBody["thresholds"]> = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2
};

export async function closeAndIssue(
  req: Request<unknown, unknown, CloseAndIssueBody>,
  res: Response
) {
  const { abn, taxType, periodId, thresholds } = req.body;
  // TODO: set state -> CLOSING, compute final_liability_cents, merkle_root, running_balance_hash beforehand
  const thr = thresholds ? { ...defaultThresholds, ...thresholds } : defaultThresholds;
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body as any; // EFT|BPAY
  const pr = await pool.query(
    "select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body as any;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = (req.body as any)?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
