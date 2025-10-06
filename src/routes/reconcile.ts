import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { pool } from "../db/pool";

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr =
    thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query(
    `SELECT payload
       FROM rpt_tokens
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3
      ORDER BY id DESC
      LIMIT 1`,
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query(
      `UPDATE periods
          SET state = 'RELEASED'
        WHERE abn = $1 AND tax_type = $2 AND period_id = $3`,
      [abn, taxType, periodId]
    );
    return res.json(r);
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
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  await pool.query(
    `INSERT INTO reconciliation_imports(abn, tax_type, period_id, provider_ref, imported_rows, manifest_sha256, raw_csv)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      req.body?.abn || null,
      req.body?.taxType || null,
      req.body?.periodId || null,
      req.body?.providerRef || null,
      rows.length,
      req.body?.manifestSha256 || null,
      csvText,
    ]
  );
  return res.json({ ingested: rows.length });
}

export async function evidence(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
