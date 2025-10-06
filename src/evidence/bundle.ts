import { Pool } from "pg";
const pool = new Pool();

type BasLabels = { W1: number; W2: number; "1A": number; "1B": number };

function centsToDollars(value: any): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num) / 100;
}

function deriveBasLabels(period: any, ledgerRows: any[]): BasLabels {
  const labels: { W1: number | null; W2: number | null; "1A": number | null; "1B": number | null } = {
    W1: null,
    W2: null,
    "1A": null,
    "1B": null,
  };

  const stored = period?.bas_labels || period?.bas_summary;
  if (stored && typeof stored === "object") {
    if (stored.W1 !== undefined) labels.W1 = typeof stored.W1 === "number" ? stored.W1 : centsToDollars(stored.W1);
    if (stored.W2 !== undefined) labels.W2 = typeof stored.W2 === "number" ? stored.W2 : centsToDollars(stored.W2);
    if (stored["1A"] !== undefined)
      labels["1A"] = typeof stored["1A"] === "number" ? stored["1A"] : centsToDollars(stored["1A"]);
    if (stored["1B"] !== undefined)
      labels["1B"] = typeof stored["1B"] === "number" ? stored["1B"] : centsToDollars(stored["1B"]);
  }

  if (period?.tax_type === "PAYGW") {
    if (labels.W2 === null && period?.final_liability_cents !== undefined) {
      labels.W2 = centsToDollars(period.final_liability_cents) ?? 0;
    }
    if (labels.W1 === null && period?.accrued_cents !== undefined) {
      labels.W1 = centsToDollars(period.accrued_cents);
    }
  }

  if (period?.tax_type === "GST") {
    let gstOnSalesCents = 0;
    let gstOnPurchasesCents = 0;
    for (const row of ledgerRows) {
      const amount = Number(row.amount_cents ?? 0);
      if (!Number.isFinite(amount)) continue;
      if (amount >= 0) gstOnSalesCents += amount;
      else gstOnPurchasesCents += Math.abs(amount);
    }
    if (labels["1A"] === null) labels["1A"] = Math.round(gstOnSalesCents) / 100;
    if (labels["1B"] === null) labels["1B"] = Math.round(gstOnPurchasesCents) / 100;
  }

  return {
    W1: labels.W1 ?? 0,
    W2: labels.W2 ?? 0,
    "1A": labels["1A"] ?? 0,
    "1B": labels["1B"] ?? 0,
  };
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (
    await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId])
  ).rows[0];
  const rpt = (
    await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [
      abn,
      taxType,
      periodId,
    ])
  ).rows[0];
  const deltas = (
    await pool.query(
      "select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn= and tax_type= and period_id= order by id",
      [abn, taxType, periodId],
    )
  ).rows;
  const last = deltas[deltas.length - 1];
  const basLabels = deriveBasLabels(p ?? {}, deltas);
  const bundle = {
    bas_labels: basLabels,
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [], // TODO: populate from recon diffs
  };
  return bundle;
}
