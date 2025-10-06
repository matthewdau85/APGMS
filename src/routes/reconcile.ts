import type { Request, Response } from "express";
import { Pool } from "pg";

import { buildEvidenceBundle } from "../evidence/bundle";
import { debit as paytoDebit } from "../payto/adapter";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { issueRPT } from "../rpt/issuer";
import { parseSettlementCSV } from "../settlement/splitParser";

const pool = new Pool();

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId, thresholds } = (req.body ?? {}) as {
    abn?: string;
    taxType?: string;
    periodId?: string;
    thresholds?: Record<string, unknown>;
  };
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_IDENTIFIERS" });
  }

  // TODO: set state -> CLOSING, compute final_liability_cents, merkle_root, running_balance_hash beforehand
  const thr =
    thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "FAILED_TO_ISSUE_RPT" });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = (req.body ?? {}) as {
    abn?: string;
    taxType?: string;
    periodId?: string;
    rail?: string;
  }; // EFT|BPAY
  if (!abn || !taxType || !periodId || !rail) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }

  const pr = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "FAILED_TO_RELEASE" });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = (req.body ?? {}) as {
    abn?: string;
    amount_cents?: number;
    reference?: string;
  };
  if (!abn || typeof amount_cents !== "number" || !reference) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = (req.body as { csv?: string } | undefined)?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

function parseLabels(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item).split(","))
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function parseNumberParam(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function evidence(req: Request, res: Response) {
  const { abn, pid } = req.params as { abn?: string; pid?: string };
  if (!abn || !pid) {
    return res.status(400).json({ error: "MISSING_IDENTIFIERS" });
  }

  const taxTypeParam = req.query.taxType;
  const taxType = typeof taxTypeParam === "string" && taxTypeParam.length > 0 ? taxTypeParam.toUpperCase() : "GST";
  const labels = parseLabels(req.query.labels);
  const expected = parseNumberParam(req.query.expectedCents);
  const actual = parseNumberParam(req.query.actualCents);

  try {
    const bundle = await buildEvidenceBundle(abn, taxType, pid, labels, expected, actual);
    return res.json(bundle.details);
  } catch (err) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    if (message === "PERIOD_NOT_FOUND") return res.status(404).json({ error: message });
    if (message === "MISSING_IDENTIFIERS") return res.status(400).json({ error: message });
    console.error("[evidence]", err);
    return res.status(500).json({ error: "FAILED_TO_BUILD_EVIDENCE" });
  }
}
