import type { Request, Response } from "express";
import { pool } from "../index.js";

type EvidenceRow = {
  created_at: string;
  payload: any;
  payload_c14n: string;
  payload_sha256: string;
  signature: string;
};

export async function evidence(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    const client = await pool.connect();
    try {
      const periodQ = await client.query(
        `SELECT state, accrued_cents, credited_to_owa_cents, final_liability_cents,
                merkle_root, running_balance_hash, anomaly_vector, thresholds
         FROM periods
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
        [abn, taxType, periodId]
      );
      if (!periodQ.rows.length) {
        return res.status(404).json({ error: "Period not found" });
      }
      const period = periodQ.rows[0];

      const rptQ = await client.query<EvidenceRow>(
        `SELECT payload, payload_c14n, payload_sha256, signature, created_at
         FROM rpt_tokens
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3
         ORDER BY created_at DESC
         LIMIT 1`,
        [abn, taxType, periodId]
      );
      const rptRow = rptQ.rows[0] || null;

      const ledgerQ = await client.query(
        `SELECT id, amount_cents, balance_after_cents, bank_receipt_hash,
                prev_hash, hash_after, created_at
           FROM owa_ledger
          WHERE abn=$1 AND tax_type=$2 AND period_id=$3
          ORDER BY id ASC`,
        [abn, taxType, periodId]
      );

      const basLabels = { W1: null, W2: null, "1A": null, "1B": null } as Record<string, string | null>;

      res.json({
        meta: {
          generated_at: new Date().toISOString(),
          abn,
          taxType,
          periodId,
        },
        period: {
          state: period.state,
          accrued_cents: Number(period.accrued_cents ?? 0),
          credited_to_owa_cents: Number(period.credited_to_owa_cents ?? 0),
          final_liability_cents: Number(period.final_liability_cents ?? 0),
          merkle_root: period.merkle_root,
          running_balance_hash: period.running_balance_hash,
          anomaly_vector: period.anomaly_vector,
          thresholds: period.thresholds,
        },
        rpt: rptRow && {
          payload: rptRow.payload,
          payload_c14n: rptRow.payload_c14n,
          payload_sha256: rptRow.payload_sha256,
          signature: rptRow.signature,
          created_at: rptRow.created_at,
        },
        owa_ledger: ledgerQ.rows,
        bas_labels: basLabels,
        discrepancy_log: [],
      });
    } finally {
      client.release();
    }
  } catch (e: any) {
    res.status(500).json({ error: "Evidence retrieval failed", detail: String(e?.message || e) });
  }
}
