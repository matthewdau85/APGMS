import { pool } from "../db/pool";
import { getTaxTotals } from "../tax/totals";

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const periodRes = await pool.query(
    `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId]
  );
  const period = periodRes.rows[0];
  if (!period) {
    throw new Error("PERIOD_NOT_FOUND");
  }

  const rptRes = await pool.query(
    `SELECT payload, signature
       FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id DESC
      LIMIT 1`,
    [abn, taxType, periodId]
  );
  const rpt = rptRes.rows[0] ?? null;

  const totalsRecord = await getTaxTotals(abn, taxType as "PAYGW" | "GST", periodId);

  const ledgerRes = await pool.query(
    `SELECT id, amount_cents, balance_after_cents, bank_receipt_id, bank_receipt_hash, hash_after, rpt_verified, created_at
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id ASC`,
    [abn, taxType, periodId]
  );

  const receiptLedger = ledgerRes.rows
    .slice()
    .reverse()
    .find((row: any) => row.bank_receipt_id != null);

  let receipt: null | { id: number; channel: string; provider_ref: string; dry_run: boolean } = null;
  if (receiptLedger) {
    const receiptRes = await pool.query(
      `SELECT id, channel, provider_ref, dry_run
         FROM bank_receipts
        WHERE id=$1`,
      [receiptLedger.bank_receipt_id]
    );
    if (receiptRes.rowCount) {
      receipt = receiptRes.rows[0];
    }
  }

  return {
    labels: totalsRecord.labels,
    totals: totalsRecord.totals,
    rates_version: totalsRecord.rates_version,
    rpt: rpt ? { payload: rpt.payload, signature: rpt.signature } : null,
    proofs: {
      merkle_root: period.merkle_root ?? null,
      running_balance_hash: period.running_balance_hash ?? null,
    },
    receipt,
  };
}
