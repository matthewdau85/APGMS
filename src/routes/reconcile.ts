import type { Request, Response } from "express";
import { Pool } from "pg";
import type { PoolClient } from "pg";

import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";

const pool = new Pool();

function coerceNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export async function closeAndIssue(req: Request, res: Response) {
  const body = req.body ?? {};
  const abn = typeof body.abn === "string" ? body.abn : undefined;
  const period_id = body.periodId ?? body.period_id;
  const combined = typeof body.head === "string" && body.head.length > 0
    ? body.head
    : typeof body.combined === "string" && body.combined.length > 0
      ? body.combined
      : undefined;

  const delta = coerceNumber(body.deltaCents ?? body.delta);
  const expC = coerceNumber(body.expectedCents ?? body.expC);
  const tolBps = coerceNumber(body.toleranceBps ?? body.tolBps);

  if (!abn || (typeof period_id !== "string" && typeof period_id !== "number")) {
    return res.status(400).json({ error: "Missing abn/period" });
  }
  if (!combined) {
    return res.status(400).json({ error: "Missing reconciliation head" });
  }

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "database unavailable", detail: message });
  }

  try {
    const rpt = await issueRPT(client, {
      abn,
      periodId: period_id,
      head: combined,
      deltaCents: delta,
      expectedCents: expC,
      toleranceBps: tolBps
    });
    return res.json(rpt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  } finally {
    client?.release();
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body || {};
  try {
    const pr = await pool.query(
      "select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
      [abn, taxType, periodId]
    );
    if (pr.rowCount === 0) {
      return res.status(400).json({ error: "NO_RPT" });
    }
    const payload = pr.rows[0].payload;
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query(
      "update periods set state='RELEASED' where abn= and tax_type= and period_id=",
      [abn, taxType, periodId]
    );
    return res.json(r);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: message });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body || {};
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = (req.query || {}) as Record<string, string>;
  const bundle = await buildEvidenceBundle(abn, taxType, periodId);
  res.json(bundle);
}
