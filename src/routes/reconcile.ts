import { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { RptPayload } from "../crypto/ed25519";

const pool = new Pool();

declare module "express-serve-static-core" {
  interface Locals {
    release?: {
      payload: RptPayload;
      periodRow: any;
    };
  }
}

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function loadRelease(req: Request, res: Response, next: NextFunction) {
  try {
    const { abn, taxType, periodId } = req.body;
    const rptQuery = await pool.query(
      "select payload from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
      [abn, taxType, periodId]
    );
    if (rptQuery.rowCount === 0) {
      return res.status(400).json({ error: "NO_RPT" });
    }
    const payload = rptQuery.rows[0].payload as RptPayload;
    const periodQuery = await pool.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId]
    );
    res.locals.release = { payload, periodRow: periodQuery.rows[0] };
    return next();
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "LOAD_FAILED" });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body;
  const release = res.locals.release;
  if (!release) {
    return res.status(500).json({ error: "RELEASE_CONTEXT_MISSING" });
  }
  const payload = release.payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const result = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query(
      "update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId]
    );
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
