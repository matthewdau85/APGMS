import { Request, Response } from "express";
import { createHash } from "node:crypto";

import { issueRPT } from "../rpt/issuer";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { buildEvidenceDetails } from "../evidence/bundle";
import { getPool } from "../db/pool";

const pool = getPool();

function coerceNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function deriveAnomalyHash(row: any): string {
  const direct = typeof row?.anomaly_hash === "string" && row.anomaly_hash.length > 0 ? row.anomaly_hash : null;
  if (direct) return direct;

  if (row?.anomaly_vector) {
    try {
      const canonical = JSON.stringify(row.anomaly_vector);
      return createHash("sha256").update(canonical).digest("hex");
    } catch (_) {
      // fall through
    }
  }
  return "unknown";
}

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId, thresholds } = req.body ?? {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "missing abn/taxType/periodId" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: periodRows } = await client.query<{
      final_liability_cents: number | string | null;
      credited_to_owa_cents: number | string | null;
      anomaly_hash?: string | null;
      anomaly_vector?: unknown;
    }>(
      `select final_liability_cents, credited_to_owa_cents, anomaly_hash, anomaly_vector
         from periods
        where abn=$1 and tax_type=$2 and period_id=$3
        for update`,
      [abn, taxType, periodId]
    );

    if (!periodRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
    }

    const period = periodRows[0];
    const expC = coerceNumber(period.final_liability_cents);
    const actC = coerceNumber(period.credited_to_owa_cents);
    const anomalyHash = deriveAnomalyHash(period);

    const labels = await client.query<{ label: string; valueCents: number }>(
      `select label, value_cents as "valueCents"
         from bas_labels
        where abn=$1 and period_id=$2
        order by label`,
      [abn, periodId]
    );

    const details = buildEvidenceDetails(labels.rows, expC, actC, anomalyHash);

    const evidenceSql = `
      insert into evidence_bundles (abn, tax_type, period_id, details, created_at)
      values ($1,$2,$3,$4::jsonb, now())
      on conflict (abn, tax_type, period_id)
      do update set details = excluded.details
      returning id
    `;
    const evidenceParams = [abn, taxType, periodId, JSON.stringify(details)];
    const { rows: evidenceRows } = await client.query<{ id: number }>(evidenceSql, evidenceParams);

    await client.query("COMMIT");

    const rpt = await issueRPT(abn, taxType, periodId, thresholds ?? {});

    return res.json({ ok: true, bundleId: evidenceRows[0]?.id ?? null, rpt, details });
  } catch (e: any) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: e?.message ?? "closeAndIssue failed" });
  } finally {
    client.release();
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body ?? {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "missing abn/taxType/periodId" });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ payload: any }>(
      `select payload
         from rpt_tokens
        where abn=$1 and tax_type=$2 and period_id=$3
        order by created_at desc
        limit 1`,
      [abn, taxType, periodId]
    );
    if (!rows.length) {
      return res.status(400).json({ error: "NO_RPT" });
    }
    const payload = rows[0].payload;
    const releaseRail = (rail ?? payload?.rail_id ?? "EFT") as "EFT" | "BPAY";

    await resolveDestination(abn, releaseRail, payload?.reference ?? "");
    const release = await releasePayment(
      abn,
      taxType,
      periodId,
      coerceNumber(payload?.amount_cents),
      releaseRail,
      payload?.reference ?? ""
    );

    await client.query(
      `update periods set state='RELEASED'
        where abn=$1 and tax_type=$2 and period_id=$3`,
      [abn, taxType, periodId]
    );

    return res.json({ ok: true, release });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "release failed" });
  } finally {
    client.release();
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body ?? {};
  if (!abn) {
    return res.status(400).json({ error: "missing abn" });
  }
  try {
    const amt = coerceNumber(amount_cents);
    const r = await paytoDebit(abn, amt, reference ?? "");
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "payto sweep failed" });
  }
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as Record<string, string>;
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "missing abn/taxType/periodId" });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: number; details: unknown }>(
      `select id, details
         from evidence_bundles
        where abn=$1 and tax_type=$2 and period_id=$3
        order by created_at desc
        limit 1`,
      [abn, taxType, periodId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    return res.json(rows[0]);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "failed to load evidence" });
  } finally {
    client.release();
  }
}
