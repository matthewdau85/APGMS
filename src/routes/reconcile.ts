import { Request, Response } from "express";
import { Pool } from "pg";
import { z } from "zod";

import { buildEvidenceBundle } from "../evidence/bundle";
import { debit as paytoDebit } from "../payto/adapter";
import { issueRPT } from "../rpt/issuer";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";

const pool = new Pool();

const thresholdSchema = z
  .object({
    epsilon_cents: z.number().nonnegative().optional(),
    variance_ratio: z.number().nonnegative().optional(),
    dup_rate: z.number().nonnegative().optional(),
    gap_minutes: z.number().nonnegative().optional(),
    delta_vs_baseline: z.number().nonnegative().optional(),
  })
  .strict();

export const closeAndIssueSchema = z
  .object({
    abn: z.string().min(1),
    taxType: z.string().min(1),
    periodId: z.string().min(1),
    thresholds: thresholdSchema.partial().optional(),
  })
  .strict();

export const payAtoSchema = z
  .object({
    abn: z.string().min(1),
    taxType: z.string().min(1),
    periodId: z.string().min(1),
    rail: z.enum(["EFT", "BPAY"]),
  })
  .strict();

export const paytoSweepSchema = z
  .object({
    abn: z.string().min(1),
    amount_cents: z.number().int().positive(),
    reference: z.string().min(1),
  })
  .strict();

export const settlementWebhookSchema = z
  .object({
    csv: z.string().min(1),
  })
  .strict();

type CloseAndIssueBody = z.infer<typeof closeAndIssueSchema>;
type PayAtoBody = z.infer<typeof payAtoSchema>;
type PaytoSweepBody = z.infer<typeof paytoSweepSchema>;
type SettlementWebhookBody = z.infer<typeof settlementWebhookSchema>;

type EvidenceQuery = {
  abn: string;
  taxType: string;
  periodId: string;
};

export async function closeAndIssue(
  req: Request<unknown, unknown, CloseAndIssueBody>,
  res: Response,
) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const defaults = {
    epsilon_cents: 50,
    variance_ratio: 0.25,
    dup_rate: 0.01,
    gap_minutes: 60,
    delta_vs_baseline: 0.2,
  } as const;
  const thr = { ...defaults, ...thresholds };

  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(
  req: Request<unknown, unknown, PayAtoBody>,
  res: Response,
) {
  const { abn, taxType, periodId, rail } = req.body;
  const pr = await pool.query(
    "select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
    [abn, taxType, periodId],
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(
      abn,
      taxType,
      periodId,
      payload.amount_cents,
      rail,
      payload.reference,
    );
    await pool.query(
      "update periods set state='RELEASED' where abn= and tax_type= and period_id=",
      [abn, taxType, periodId],
    );
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(
  req: Request<unknown, unknown, PaytoSweepBody>,
  res: Response,
) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(
  req: Request<unknown, unknown, SettlementWebhookBody>,
  res: Response,
) {
  const rows = parseSettlementCSV(req.body.csv);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(
  req: Request<unknown, unknown, unknown, EvidenceQuery>,
  res: Response,
) {
  const { abn, taxType, periodId } = req.query;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
