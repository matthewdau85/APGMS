import { Pool } from "pg";

const pool = new Pool();

type BasLabels = Record<string, number | null>;

type DiscrepancyEntry = {
  kind: string;
  message: string;
  delta_cents?: number;
};

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const periodRes = await pool.query(
    `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId]
  );
  if (periodRes.rowCount === 0) {
    throw new Error("PERIOD_NOT_FOUND");
  }
  const period = periodRes.rows[0];

  const rptRes = await pool.query(
    `SELECT payload, payload_c14n, payload_sha256, signature, nonce, expires_at, created_at, status
       FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY created_at DESC
      LIMIT 1`,
    [abn, taxType, periodId]
  );
  const rptRow = rptRes.rows[0] || null;

  const ledgerRes = await pool.query(
    `SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id`,
    [abn, taxType, periodId]
  );
  const ledger = ledgerRes.rows.map(row => ({
    id: row.id,
    amount_cents: Number(row.amount_cents),
    balance_after_cents: Number(row.balance_after_cents),
    bank_receipt_hash: row.bank_receipt_hash,
    prev_hash: row.prev_hash,
    hash_after: row.hash_after,
    created_at: row.created_at,
  }));

  const labelsRes = await pool.query(
    `SELECT label, value_cents FROM bas_labels WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId]
  );
  const basLabels: BasLabels = { W1: null, W2: null, "1A": null, "1B": null };
  for (const row of labelsRes.rows) {
    basLabels[row.label] = Number(row.value_cents);
  }

  const ledgerCredits = ledger.filter(l => l.amount_cents > 0).reduce((sum, l) => sum + l.amount_cents, 0);
  const finalBalance = ledger.length ? ledger[ledger.length - 1].balance_after_cents : 0;
  const expectedCredits = Number(period.credited_to_owa_cents ?? 0);
  const expectedFinalLiability = Number(period.final_liability_cents ?? 0);

  const discrepancyLog: DiscrepancyEntry[] = [];
  if (ledgerCredits !== expectedCredits) {
    discrepancyLog.push({
      kind: "ledger_credit_mismatch",
      message: `Ledger credits ${ledgerCredits}c differ from period credited ${expectedCredits}c`,
      delta_cents: ledgerCredits - expectedCredits,
    });
  }
  if (finalBalance !== expectedCredits - expectedFinalLiability) {
    discrepancyLog.push({
      kind: "final_balance_mismatch",
      message: `OWA balance ${finalBalance}c differs from credited (${expectedCredits}c) minus liability (${expectedFinalLiability}c)`,
      delta_cents: finalBalance - (expectedCredits - expectedFinalLiability),
    });
  }

  return {
    meta: {
      generated_at: new Date().toISOString(),
      abn,
      taxType,
      periodId,
    },
    period: {
      state: period.state,
      accrued_cents: Number(period.accrued_cents ?? 0),
      credited_to_owa_cents: expectedCredits,
      final_liability_cents: expectedFinalLiability,
      merkle_root: period.merkle_root,
      running_balance_hash: period.running_balance_hash,
      anomaly_vector: period.anomaly_vector,
      thresholds: period.thresholds,
    },
    rpt: rptRow
      ? {
          payload: rptRow.payload,
          payload_c14n: rptRow.payload_c14n,
          payload_sha256: rptRow.payload_sha256,
          signature: rptRow.signature,
          nonce: rptRow.nonce,
          expires_at: rptRow.expires_at,
          created_at: rptRow.created_at,
          status: rptRow.status,
        }
      : null,
    owa_ledger: ledger,
    bas_labels: basLabels,
    discrepancy_log: discrepancyLog,
  };
}
