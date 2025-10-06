import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";
import crypto from "crypto";
import { zipToBase64 } from "../evidence/zip";
import { computeJsonPatch } from "../evidence/diff";

const pool = new Pool();

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr: Record<string, number> =
    thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail, approvals } = req.body;
  if (!abn || !taxType || !periodId) return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  const railId: "EFT" | "BPAY" = rail || "EFT";

  const rptRes = await pool.query(
    "select payload from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by created_at desc limit 1",
    [abn, taxType, periodId]
  );
  if (rptRes.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = rptRes.rows[0].payload;

  try {
    await resolveDestination(abn, railId, payload.reference);

    if (Array.isArray(approvals) && approvals.length) {
      const values = approvals
        .map((entry: any) => {
          if (!entry?.approver_id || !entry?.approver_role) return null;
          return [
            abn,
            taxType,
            periodId,
            String(entry.approver_id),
            String(entry.approver_role),
            entry.mfa_verified === true,
            entry.approved_at ? new Date(entry.approved_at) : new Date(),
          ];
        })
        .filter(Boolean) as any[];
      for (const row of values) {
        await pool.query(
          "insert into release_approvals(abn,tax_type,period_id,approver_id,approver_role,mfa_verified,approved_at) values ($1,$2,$3,$4,$5,$6,$7)",
          row
        );
      }
    }

    const release = await releasePayment(abn, taxType, periodId, payload.amount_cents, railId, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId]);
    return res.json(release);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: any, res: any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: any, res: any) {
  const { abn, taxType, periodId, rail = "EFT", providerRef, paidAt, amountCents, currency = "AUD", csv, receipt } = req.body || {};
  if (!abn || !taxType || !periodId || !providerRef) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId/providerRef" });
  }
  const rows = parseSettlementCSV(csv || "");
  const inferredAmount =
    Number.isFinite(Number(amountCents)) && amountCents !== null
      ? Number(amountCents)
      : rows.reduce((sum, row) => sum + Number(row.gst_cents || 0) + Number(row.net_cents || 0), 0);
  const paidAtIso = paidAt || rows[0]?.settlement_ts || new Date().toISOString();
  const settlementId = crypto.randomUUID();

  const receiptFilename = receipt?.filename ?? null;
  const receiptMime = receipt?.mime ?? null;
  const receiptBase64 = receipt?.base64 ?? null;

  await pool.query(
    `insert into settlements (
      id, abn, tax_type, period_id, provider_ref, rail,
      amount_cents, currency, paid_at, receipt_filename, receipt_mime, receipt_base64
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    on conflict (provider_ref) do update set
      amount_cents = excluded.amount_cents,
      currency = excluded.currency,
      paid_at = excluded.paid_at,
      receipt_filename = excluded.receipt_filename,
      receipt_mime = excluded.receipt_mime,
      receipt_base64 = excluded.receipt_base64
  `,
    [
      settlementId,
      abn,
      taxType,
      periodId,
      providerRef,
      rail,
      inferredAmount,
      currency,
      paidAtIso ? new Date(paidAtIso) : null,
      receiptFilename,
      receiptMime,
      receiptBase64,
    ]
  );

  return res.json({ ok: true, settlementId, providerRef, amount_cents: inferredAmount, paid_at: paidAtIso });
}

export async function evidence(req: any, res: any) {
  const { abn, taxType } = req.query as any;
  const periodId = req.params?.periodId || req.query?.periodId;
  if (!abn || !taxType || !periodId) return res.status(400).json({ error: "Missing abn/taxType/periodId" });

  try {
    const bundle = await buildEvidenceBundle(abn, taxType, periodId);
    const files = [
      {
        name: `evidence_${abn}_${periodId}_${taxType}.json`,
        contents: JSON.stringify(bundle, null, 2),
        encoding: "utf8" as BufferEncoding,
      },
    ];
    if (bundle.settlement?.receipt_base64 && bundle.settlement.receipt_filename) {
      files.push({
        name: bundle.settlement.receipt_filename,
        contents: bundle.settlement.receipt_base64,
        encoding: "base64" as BufferEncoding,
      });
    }
    const zipBase64 = zipToBase64(files);

    res.json({
      evidence: bundle,
      zip: {
        filename: `evidence_${abn}_${periodId}.zip`,
        base64: zipBase64,
      },
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
}

export async function evidenceDiff(req: any, res: any) {
  const { abn, taxType } = req.query as any;
  const periodId = req.params?.periodId || req.query?.periodId;
  if (!abn || !taxType || !periodId) return res.status(400).json({ error: "Missing abn/taxType/periodId" });

  const prevRes = await pool.query(
    "select period_id from evidence_bundles where abn=$1 and tax_type=$2 and period_id < $3 order by period_id desc limit 1",
    [abn, taxType, periodId]
  );
  if (prevRes.rowCount === 0) {
    return res.json({ patch: [], previousPeriodId: null });
  }
  const previousPeriodId = prevRes.rows[0].period_id;

  try {
    const current = await buildEvidenceBundle(abn, taxType, periodId);
    const previous = await buildEvidenceBundle(abn, taxType, previousPeriodId);
    const patch = computeJsonPatch(previous, current);
    res.json({ patch, previousPeriodId });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
}
