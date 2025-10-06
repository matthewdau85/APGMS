import { randomUUID } from "crypto";
import { Pool } from "pg";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releaseToBank, getDefaultReleaseDependencies, ReleaseError } from "../payments/release";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import type { Rail } from "../rails/port";

const pool = new Pool();
const releaseDeps = getDefaultReleaseDependencies();

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body || {};
  const thr =
    thresholds ||
    { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || String(e) });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }
  const { rows } = await pool.query(
    `SELECT payload
       FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id DESC
      LIMIT 1`,
    [abn, taxType, periodId]
  );
  if (rows.length === 0) {
    return res.status(400).json({ error: "NO_RPT" });
  }
  const payload = rows[0].payload || {};
  const railInput = String(req.body?.rail || payload.rail_id || "EFT").toUpperCase();
  if (railInput !== "EFT" && railInput !== "BPAY") {
    return res.status(400).json({ error: "INVALID_RAIL" });
  }
  const amountRaw = Number(payload.amount_cents ?? req.body?.amountCents ?? 0);
  if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
    return res.status(400).json({ error: "INVALID_AMOUNT" });
  }
  const reference = String(payload.reference || req.body?.reference || "").trim();
  if (!reference) {
    return res.status(400).json({ error: "MISSING_REFERENCE" });
  }
  const headerKey: string | undefined =
    typeof req.get === "function"
      ? req.get("Idempotency-Key")
      : req.headers?.["idempotency-key"];
  const idemKey = (headerKey || randomUUID()).toString();

  try {
    const settlement = await releaseToBank(
      {
        abn,
        taxType,
        periodId,
        rail: railInput as Rail,
        reference,
        amountCents: Math.abs(amountRaw),
        idempotencyKey: idemKey,
      },
      releaseDeps
    );
    await pool.query(
      `UPDATE periods
          SET state='RELEASED'
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    return res.json({ ok: true, settlement });
  } catch (err) {
    if (err instanceof ReleaseError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "Release failed", detail: String((err as any)?.message || err) });
  }
}

export async function paytoSweep(req: any, res: any) {
  const { abn, amount_cents, reference } = req.body || {};
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: any, res: any) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
