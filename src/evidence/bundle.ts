import { Pool } from "pg";
const pool = new Pool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId])).rows[0];
  const rpt = (await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId])).rows[0];
  const deltas = (await pool.query("select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn= and tax_type= and period_id= order by id", [abn, taxType, periodId])).rows;
  const last = deltas[deltas.length-1];
  const settlement = (await pool.query("select rail, provider_ref, paid_at from settlements where period_id= order by paid_at desc limit 1", [periodId])).rows[0] || null;
  const approvals = (await pool.query("select gate, actor, state, created_at from approvals where period_id= order by created_at", [periodId])).rows;
  const gates = (await pool.query("select gate, state, reason from gate_transitions where period_id= order by updated_at", [periodId])).rows;
  const narrative = gates.length
    ? gates.map((g:any) => {
        const reason = g.reason ? `(${g.reason})` : "";
        return `${g.gate}:${g.state}${reason}`;
      }).join(" -> ")
    : `No gate transitions recorded for period ${periodId}`;
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null }, // TODO: populate
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [],  // TODO: populate from recon diffs
    settlement,
    rules: {
      manifest_sha256: process.env.RULES_MANIFEST_SHA256 || null,
      rates_version: rpt?.rates_version ?? null,
    },
    approvals,
    narrative,
  };
  return bundle;
}
