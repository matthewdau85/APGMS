import { Pool } from "pg";
import crypto from "crypto";

const pool = new Pool();

function sortCanonical(value: any): any {
  if (Array.isArray(value)) {
    return value.map((v) => sortCanonical(v));
  }
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => [key, sortCanonical((value as Record<string, unknown>)[key])]);
    return Object.fromEntries(entries);
  }
  return value;
}

function canonicalJson(value: any): string {
  return JSON.stringify(sortCanonical(value));
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const periodQ = await pool.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  const p = periodQ.rows[0] ?? null;

  const rptQ = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  const rpt = rptQ.rows[0] ?? null;

  const deltas = (
    await pool.query(
      "select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
      [abn, taxType, periodId]
    )
  ).rows;
  const last = deltas.length ? deltas[deltas.length - 1] : null;

  const totalsQ = await pool.query(
    "select evidence_payload, evidence_sha256, gross_cents, taxable_cents, liability_cents, event_count from period_tax_totals where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  const totals = totalsQ.rows[0] ?? null;
  const evidencePayload = totals?.evidence_payload ?? null;
  let evidenceSha = totals?.evidence_sha256 ?? null;
  if (!evidenceSha && evidencePayload) {
    evidenceSha = crypto.createHash("sha256").update(canonicalJson(evidencePayload)).digest("hex");
  }

  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [],
    period_totals: totals
      ? {
          gross_cents: Number(totals.gross_cents ?? 0),
          taxable_cents: Number(totals.taxable_cents ?? 0),
          liability_cents: Number(totals.liability_cents ?? 0),
          event_count: Number(totals.event_count ?? 0),
        }
      : null,
    period_row: p,
    evidence_payload: evidencePayload,
    evidence_sha256: evidenceSha,
  };
  return bundle;
}
