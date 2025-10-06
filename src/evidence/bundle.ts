import { getPool } from "../db/pool";
import { getRulesEngine } from "../rules/engine";

const pool = getPool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const periodQuery = await pool.query(
    "select * from periods where abn = $1 and tax_type = $2 and period_id = $3",
    [abn, taxType, periodId]
  );
  const p = periodQuery.rows[0];

  const rptQuery = await pool.query(
    "select * from rpt_tokens where abn = $1 and tax_type = $2 and period_id = $3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  const rpt = rptQuery.rows[0];

  const ledgerQuery = await pool.query(
    "select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn = $1 and tax_type = $2 and period_id = $3 order by id",
    [abn, taxType, periodId]
  );
  const deltas = ledgerQuery.rows;
  const last = deltas[deltas.length - 1];

  const engine = getRulesEngine();

  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [],
    rules_manifest: {
      rates_version: engine.ratesVersion(),
    },
  };
  return bundle;
}
