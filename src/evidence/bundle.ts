import { Pool } from "pg";
const pool = new Pool();

interface DiscrepancyEntry {
  code: string;
  details: Record<string, unknown>;
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const period = (
    await pool.query(
      "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    )
  ).rows[0];

  if (!period) {
    return {
      bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
      rpt_payload: null,
      rpt_signature: null,
      owa_ledger_deltas: [],
      bank_receipt_hash: null,
      anomaly_thresholds: {},
      discrepancy_log: [
        { code: "PERIOD_NOT_FOUND", details: { abn, taxType, periodId } }
      ]
    };
  }

  const rpt = (
    await pool.query(
      "SELECT * FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id DESC LIMIT 1",
      [abn, taxType, periodId]
    )
  ).rows[0] ?? null;

  const deltas = (
    await pool.query(
      `SELECT created_at AS ts, amount_cents, balance_after_cents, hash_after, bank_receipt_hash
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id`,
      [abn, taxType, periodId]
    )
  ).rows;
  const last = deltas[deltas.length - 1];

  const discrepancyLog: DiscrepancyEntry[] = [];
  const credited = Number(period.credited_to_owa_cents ?? 0);
  const finalLiability = Number(period.final_liability_cents ?? 0);

  const taxBalance = deltas.reduce((acc: number, row: any) => {
    const receipt: string = row.bank_receipt_hash ?? "";
    if (receipt.startsWith("settle:net:")) {
      return acc;
    }
    return acc + Number(row.amount_cents ?? 0);
  }, 0);

  if (credited !== finalLiability) {
    discrepancyLog.push({
      code: "FINAL_VS_CREDITED",
      details: {
        credited_to_owa_cents: credited,
        final_liability_cents: finalLiability,
        delta_cents: finalLiability - credited
      }
    });
  }

  if (taxBalance !== finalLiability) {
    discrepancyLog.push({
      code: "TAX_LEDGER_MISMATCH",
      details: {
        tax_ledger_total_cents: taxBalance,
        final_liability_cents: finalLiability,
        delta_cents: taxBalance - finalLiability
      }
    });
  }

  if (!rpt) {
    discrepancyLog.push({
      code: "RPT_MISSING",
      details: { state: period.state }
    });
  }

  return {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null },
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: period.thresholds ?? {},
    discrepancy_log: discrepancyLog
  };
}
