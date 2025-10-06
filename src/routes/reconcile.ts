import { Request, Response } from "express";
import { z } from "../validation/zod";

import { appendAudit } from "../audit/appendOnly";
import { buildEvidenceBundle } from "../evidence/bundle";
import { debit as paytoDebit } from "../payto/adapter";
import { pool } from "../db/pool";
import { issueRPT } from "../rpt/issuer";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";

const closeSchema = z.object({
  abn: z.string().min(1),
  taxType: z.enum(["PAYGW", "GST"]),
  periodId: z.string().min(1),
  thresholds: z.optional(z.record(z.number())),
});

const paySchema = z.object({
  abn: z.string().min(1),
  taxType: z.enum(["PAYGW", "GST"]),
  periodId: z.string().min(1),
  rail: z.enum(["EFT", "BPAY"]),
});

const sweepSchema = z.object({
  abn: z.string().min(1),
  amount_cents: z.coerce.number().int().positive(),
  reference: z.string().min(1),
});

const settlementSchema = z.object({
  csv: z.string().min(1),
});

const evidenceQuery = z.object({
  abn: z.string().min(1),
  taxType: z.enum(["PAYGW", "GST"]),
  periodId: z.string().min(1),
});

export async function closeAndIssue(req: Request, res: Response) {
  res.locals.routePath = "/api/close-issue";
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION_FAILED", issues: parsed.error.issues });
  }

  const { abn, taxType, periodId, thresholds } = parsed.data;
  try {
    await appendAudit(req.user?.id ?? "system", "close", {
      abn,
      taxType,
      periodId,
      thresholds,
      requestId: req.requestId,
    });

    const rpt = await issueRPT(abn, taxType, periodId, thresholds ?? {}, {
      actor: req.user?.id ?? "system",
      requestId: req.requestId,
    });
    return res.json(rpt);
  } catch (error: any) {
    req.log?.("error", "close_issue_failed", {
      error: error?.message ?? String(error),
      requestId: req.requestId,
    });
    return res.status(400).json({ error: error?.message || "CLOSE_FAILED" });
  }
}

export async function payAto(req: Request, res: Response) {
  res.locals.routePath = "/api/pay";
  const parsed = paySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION_FAILED", issues: parsed.error.issues });
  }

  const { abn, taxType, periodId, rail } = parsed.data;
  const rpt = await pool.query(
    `SELECT payload FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3
     ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );

  if (rpt.rowCount === 0) {
    return res.status(400).json({ error: "NO_RPT" });
  }

  const payload = rpt.rows[0].payload;
  const amountCents = Number(payload.amount_cents);

  try {
    await resolveDestination(abn, rail, payload.reference);
    await appendAudit(req.user?.id ?? "system", "release_attempt", {
      abn,
      taxType,
      periodId,
      amountCents,
      rail,
      reference: payload.reference,
      requestId: req.requestId,
    });

    const releaseResult = await releasePayment({
      abn,
      taxType,
      periodId,
      amountCents,
      rail,
      reference: payload.reference,
      actor: req.user?.id ?? "system",
      requestId: req.requestId,
    });

    await pool.query(
      "UPDATE periods SET state='RELEASED' WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    );

    return res.json(releaseResult);
  } catch (error: any) {
    req.log?.("error", "release_failed", {
      error: error?.message ?? String(error),
      requestId: req.requestId,
    });
    return res.status(400).json({ error: error?.message || "RELEASE_FAILED" });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  res.locals.routePath = "/api/payto/sweep";
  const parsed = sweepSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION_FAILED", issues: parsed.error.issues });
  }

  const { abn, amount_cents, reference } = parsed.data;
  const result = await paytoDebit(abn, amount_cents, reference);

  await appendAudit(req.user?.id ?? "system", "payto_sweep", {
    abn,
    amount_cents,
    reference,
    requestId: req.requestId,
  });

  return res.json(result);
}

export async function settlementWebhook(req: Request, res: Response) {
  res.locals.routePath = "/api/settlement/webhook";
  const parsed = settlementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION_FAILED", issues: parsed.error.issues });
  }

  const rows = parseSettlementCSV(parsed.data.csv);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  res.locals.routePath = "/api/evidence";
  const parsed = evidenceQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION_FAILED", issues: parsed.error.issues });
  }

  const { abn, taxType, periodId } = parsed.data;
  const bundle = await buildEvidenceBundle(abn, taxType, periodId);

  await appendAudit(req.user?.id ?? "system", "evidence_export", {
    abn,
    taxType,
    periodId,
    requestId: req.requestId,
  });

  return res.json(bundle);
}
