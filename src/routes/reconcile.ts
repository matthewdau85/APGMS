import type { Request, Response } from "express";
import { Pool } from "pg";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";

const pool = new Pool();

type CloseAndIssueBody = {
  abn: string;
  taxType: "PAYGW" | "GST";
  periodId: string;
  thresholds?: Record<string, number>;
};

type PayAtoBody = {
  abn: string;
  taxType: string;
  periodId: string;
  rail: "EFT" | "BPAY";
};

type RptRow = {
  payload: {
    reference: string;
    amount_cents: number;
  };
};

type EvidenceQuery = {
  abn?: string;
  taxType?: string;
  periodId?: string;
};

export async function closeAndIssue(req: Request<unknown, unknown, CloseAndIssueBody>, res: Response) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr =
    thresholds ??
    ({
      epsilon_cents: 50,
      variance_ratio: 0.25,
      dup_rate: 0.01,
      gap_minutes: 60,
      delta_vs_baseline: 0.2,
    } as Record<string, number>);
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ error: message });
  }
}

export async function payAto(req: Request<unknown, unknown, PayAtoBody>, res: Response) {
  const { abn, taxType, periodId, rail } = req.body;
  const pr = await pool.query<RptRow>(
    "select payload from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0]?.payload;
  if (!payload || typeof payload.reference !== "string" || typeof payload.amount_cents !== "number") {
    return res.status(400).json({ error: "INVALID_RPT_PAYLOAD" });
  }
  try {
    await resolveDestination(abn, rail, payload.reference);
    const release = await releasePayment(
      abn,
      taxType,
      periodId,
      payload.amount_cents,
      rail,
      payload.reference
    );
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [
      abn,
      taxType,
      periodId,
    ]);
    return res.json(release);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ error: message });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body as {
    abn: string;
    amount_cents: number;
    reference: string;
  };
  const result = await paytoDebit(abn, amount_cents, reference);
  return res.json(result);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = typeof req.body?.csv === "string" ? req.body.csv : "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request<unknown, unknown, unknown, EvidenceQuery>, res: Response) {
  const { abn, taxType, periodId } = req.query;
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }
  const bundle = await buildEvidenceBundle(abn, taxType, periodId);
  return res.json(bundle);
}
