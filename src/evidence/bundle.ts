import { getPool } from "../db/pool";

type ReconTotals = {
  ledger_type: "GST" | "NET";
  total_cents: string | number | null;
  credit_cents: string | number | null;
  debit_cents: string | number | null;
};

type ReversalTotals = {
  ledger_type: string;
  reversals: string | number | null;
};

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const pool = getPool();
  const periodRow = (await pool.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  )).rows[0];
  const rpt = (await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  )).rows[0];
  const deltas = (await pool.query(
    "select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
    [abn, taxType, periodId]
  )).rows;
  const last = deltas[deltas.length - 1];

  let recon: ReconTotals[] = [];
  let reversals: ReversalTotals[] = [];
  try {
    recon = (await pool.query(
      `select ledger_type, sum(amount_cents)::bigint as total_cents,
              sum(case when amount_cents > 0 then amount_cents else 0 end)::bigint as credit_cents,
              sum(case when amount_cents < 0 then amount_cents else 0 end)::bigint as debit_cents
         from settlement_ledger
        where abn=$1 and tax_type=$2 and period_id=$3
        group by ledger_type`,
      [abn, taxType, periodId]
    )).rows as ReconTotals[];
  } catch (err: any) {
    if (err?.code !== "42P01") throw err;
  }

  try {
    reversals = (await pool.query(
      `select ledger_type, count(*)::bigint as reversals
         from settlement_reversals
        where abn=$1 and tax_type=$2 and period_id=$3
        group by ledger_type`,
      [abn, taxType, periodId]
    )).rows as ReversalTotals[];
  } catch (err: any) {
    if (err?.code !== "42P01") throw err;
  }

  const byType = new Map(recon.map((r) => [r.ledger_type, r]));
  const gst = byType.get("GST");
  const net = byType.get("NET");

  const netTotal = Number(net?.total_cents ?? 0);
  const gstTotal = Number(gst?.total_cents ?? 0);
  const basLabels = {
    W1: Math.max(netTotal, 0),
    W2: Math.max(-netTotal, 0),
    "1A": Math.max(gstTotal, 0),
    "1B": Math.max(-gstTotal, 0)
  };

  const credited = Number(periodRow?.credited_to_owa_cents ?? 0);
  const finalLiability = Number(periodRow?.final_liability_cents ?? 0);
  const totalSettlement = recon.reduce((sum, row) => sum + Number(row.total_cents ?? 0), 0);
  const reversalCount = reversals.reduce((sum, row) => sum + Number(row.reversals ?? 0), 0);
  const reversalNotes = reversals.map((row) => `${row.ledger_type}:${row.reversals}`).join(", ");

  const discrepancyLog = [
    {
      metric: "OWA_VS_SETTLEMENT",
      expected_cents: credited,
      actual_cents: totalSettlement,
      delta_cents: totalSettlement - credited,
      notes: "Sum of GST/NET settlement ledger entries versus credited_to_owa_cents"
    },
    {
      metric: "GST_COMPONENT",
      expected_cents: finalLiability,
      actual_cents: gstTotal,
      delta_cents: gstTotal - finalLiability,
      notes: "GST ledger total versus final_liability_cents"
    },
    {
      metric: "REVERSALS_RECORDED",
      expected_cents: 0,
      actual_cents: reversalCount,
      delta_cents: reversalCount,
      notes: reversalNotes || "No reversals recorded"
    }
  ];

  const bundle = {
    bas_labels: basLabels,
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: periodRow?.thresholds ?? {},
    discrepancy_log: discrepancyLog
  };
  return bundle;
}
