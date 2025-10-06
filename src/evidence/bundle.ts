import { pool } from "../db/pool";
import {
  selectLedgerDeltas,
  selectLatestRptToken,
  selectPeriodByKey,
} from "../db/queries";

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const period = (await pool.query(selectPeriodByKey(abn, taxType, periodId))).rows[0];
  const rpt = (await pool.query(selectLatestRptToken(abn, taxType, periodId))).rows[0];
  const deltas = (await pool.query(selectLedgerDeltas(abn, taxType, periodId))).rows;
  const last = deltas[deltas.length - 1];
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: period?.thresholds ?? {},
    discrepancy_log: [],
  };
  return bundle;
}
