import { latestRpt } from "../persistence/rptRepository";
import { latestLedger } from "../persistence/ledgerRepository";
import { getPeriod } from "../services/periodService";
import { query } from "../persistence/db";

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const period = await getPeriod(abn, taxType, periodId);
  if (!period) {
    throw new Error("PERIOD_NOT_FOUND");
  }
  const rpt = await latestRpt(abn, taxType, periodId);
  const { rows: ledgerRows } = await query<{
    id: number;
    amount_cents: string;
    balance_after_cents: string;
    bank_receipt_hash: string | null;
    prev_hash: string | null;
    hash_after: string | null;
    created_at: Date;
  }>(
    `SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id`,
    [abn, taxType, periodId],
  );
  const last = await latestLedger(abn, taxType, periodId);
  return {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: ledgerRows,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: period.thresholds ?? {},
    discrepancy_log: [],
  };
}
