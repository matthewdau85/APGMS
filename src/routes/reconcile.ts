import { Request, Response } from "express";
import { PoolClient } from "pg";
import { getPool } from "../db/pool";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { executeRelease } from "../release/service";
import { paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { sendError, respond, withEnvelope, buildErrorBody } from "../utils/responses";
import { HttpError } from "../utils/errors";
import { saveIdempotencyResult } from "../middleware/idempotency";
import { FEATURES } from "../config/features";
import { appendAudit } from "../audit/appendOnly";

function requestId(res: Response): string {
  return (res.locals as any)?.requestId;
}

function idempotencyKey(res: Response): string | undefined {
  return (res.locals as any)?.idempotencyKey;
}

export async function closeAndIssue(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId, thresholds } = req.body || {};
    const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return respond(res, 200, { rpt });
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(400, "RPT_FAILED", "Failed to issue RPT", e instanceof Error ? e.message : String(e));
    return sendError(res, err.status, { title: err.message, detail: err.detail, code: err.code });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body || {};
  const idemKey = idempotencyKey(res);
  try {
    const result = await executeRelease({
      abn,
      taxType,
      periodId,
      rail: (rail || "EFT").toUpperCase() as "EFT" | "BPAY",
      requestId: requestId(res),
      idempotencyKey: idemKey,
    });
    const body = withEnvelope(res, {
      provider_ref: result.provider_ref,
      paid_at: result.paid_at,
      settlement_id: result.settlement_id,
      reused: result.reused,
    });
    if (idemKey) {
      await saveIdempotencyResult(null, idemKey, "DONE", body);
    }
    return res.status(200).json(body);
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, "RELEASE_FAILED", "Failed to release payment", e instanceof Error ? e.message : String(e));
    const body = buildErrorBody(res, err.status, { title: err.message, detail: err.detail, code: err.code });
    res.status(err.status).json(body);
    if (idemKey) {
      await saveIdempotencyResult(null, idemKey, "FAILED", body);
    }
    return body;
  }
}

export async function paytoSweep(req: Request, res: Response) {
  try {
    const { abn, amount_cents, reference } = req.body || {};
    const r = await paytoDebit(abn, amount_cents, reference);
    return respond(res, 200, { result: r });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return sendError(res, 500, { title: "PayTo sweep failed", detail: err, code: "PAYTO_SWEEP_FAILED" });
  }
}

function parseImport(req: Request) {
  if (typeof req.body === "string") {
    return parseSettlementCSV(req.body);
  }
  if (Array.isArray(req.body)) {
    return req.body;
  }
  if (req.body?.rows && Array.isArray(req.body.rows)) {
    return req.body.rows;
  }
  if (typeof req.body?.csv === "string") {
    return parseSettlementCSV(req.body.csv);
  }
  throw new HttpError(400, "INVALID_IMPORT", "Unsupported settlement import payload");
}

async function reconcileRow(client: PoolClient, row: any, requestIdValue: string) {
  const ref = String(row.provider_ref || row.receipt_id || "").trim();
  if (!ref) return { matched: false };
  const { rows } = await client.query<{ id: string; meta: any; period_id: string }>(
    "select id::text as id, meta, period_id from settlements where provider_ref=$1",
    [ref]
  );
  if (!rows.length) return { matched: false, provider_ref: ref };
  const settlement = rows[0];
  const meta = settlement.meta || {};
  const verifiedAt = new Date().toISOString();
  meta.reconciled_at = verifiedAt;
  meta.reconciliation = {
    provider_ref: ref,
    amount_cents: Number(row.amount_cents ?? row.amountCents ?? row.amount),
    paid_at: row.paid_at || row.settled_at || row.created_at || verifiedAt,
    raw: row.raw ?? row,
  };
  await client.query("update settlements set meta=$1::jsonb, paid_at=$2 where id=$3", [
    meta,
    new Date(meta.reconciliation.paid_at).toISOString(),
    settlement.id,
  ]);
  if (meta.ledger_id) {
    await client.query("update owa_ledger set rpt_verified=true where id=$1", [meta.ledger_id]);
  }
  if (meta.abn && meta.tax_type && meta.period_ref) {
    await client.query(
      "update periods set state='RECONCILED' where abn=$1 and tax_type=$2 and period_id=$3",
      [meta.abn, meta.tax_type, meta.period_ref]
    );
  }
  await appendAudit(
    "settlement",
    "reconciled",
    { provider_ref: ref, settlement_id: settlement.id, reconciled_at: verifiedAt, requestId: requestIdValue },
    client
  );
  return { matched: true, provider_ref: ref, period_id: settlement.period_id };
}

export async function settlementImport(req: Request, res: Response) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const rows = parseImport(req);
    await client.query("BEGIN");
    let matched = 0;
    for (const row of rows) {
      const result = await reconcileRow(client, row, requestId(res));
      if (result.matched) matched++;
    }
    await client.query("COMMIT");
    return respond(res, 200, { imported: rows.length, matched });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    const err = e instanceof HttpError ? e : new HttpError(400, "IMPORT_FAILED", "Failed to import settlement file", e instanceof Error ? e.message : String(e));
    return sendError(res, err.status, { title: err.message, detail: err.detail, code: err.code });
  } finally {
    client.release();
  }
}

export async function evidence(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId } = req.query as any;
    const bundle = await buildEvidenceBundle(abn, taxType, periodId, requestId(res));
    return respond(res, 200, bundle);
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(400, "EVIDENCE_FAILED", "Failed to build evidence", e instanceof Error ? e.message : String(e));
    return sendError(res, err.status, { title: err.message, detail: err.detail, code: err.code });
  }
}

export async function integrationsStatus(_req: Request, res: Response) {
  const pool = getPool();
  const latest = await pool.query<{ provider_ref: string; paid_at: Date; rail: string }>(
    "select provider_ref, paid_at, rail from settlements order by paid_at desc limit 1"
  );
  const recon = await pool.query<{ latest: Date }>(
    "select max((meta->>'reconciled_at')::timestamptz) as latest from settlements"
  );
  return respond(res, 200, {
    rail: {
      mode: FEATURES.BANKING ? "LIVE" : "SIMULATED",
      last_provider_ref: latest.rows[0]?.provider_ref ?? null,
      last_paid_at: latest.rows[0]?.paid_at ? latest.rows[0].paid_at.toISOString() : null,
    },
    reconciliation: {
      last_import_at: recon.rows[0]?.latest ? new Date(recon.rows[0].latest).toISOString() : null,
    },
  });
}
