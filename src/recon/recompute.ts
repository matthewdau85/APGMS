// src/recon/recompute.ts
import { Pool } from "pg";
import { appendAudit } from "../audit/appendOnly";

const pool = new Pool();
const DEFAULT_TOLERANCE = 100;

function asNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function resolveTolerance(): number {
  const raw = process.env.RECON_TOLERANCE_CENTS;
  if (!raw) return DEFAULT_TOLERANCE;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_TOLERANCE;
}

export interface ReconResult {
  schema: "recon.v1.result";
  abn: string;
  period_id: string;
  generated_at: string;
  tolerance_cents: number;
  ok: boolean;
  state: string;
  paygw: {
    expected_cents: number;
    reported_cents: number;
    delta_cents: number;
    event_count: number;
  };
  gst: {
    expected_cents: number;
    reported_cents: number;
    delta_cents: number;
    event_count: number;
  };
}

export async function recomputeRecon(abn: string, periodId: string): Promise<ReconResult> {
  const tolerance = resolveTolerance();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const payrollAgg = await client.query(
      `SELECT
         COALESCE(SUM(expected_withholding_cents),0)  AS expected_withholding_cents,
         COALESCE(SUM(withheld_total_cents),0)       AS reported_withholding_cents,
         COUNT(*)::bigint                            AS event_count,
         MAX(event_ts)                               AS last_event_ts
       FROM payroll_events
       WHERE employer_abn = $1 AND period_id = $2`,
      [abn, periodId]
    );

    const posAgg = await client.query(
      `SELECT
         COALESCE(SUM(expected_gst_cents),0) AS expected_gst_cents,
         COALESCE(SUM(gst_total_cents),0)    AS reported_gst_cents,
         COUNT(*)::bigint                    AS event_count,
         MAX(event_ts)                       AS last_event_ts
       FROM pos_events
       WHERE merchant_abn = $1 AND period_id = $2`,
      [abn, periodId]
    );

    const paygwExpected = asNumber(payrollAgg.rows[0]?.expected_withholding_cents);
    const paygwReported = asNumber(payrollAgg.rows[0]?.reported_withholding_cents);
    const paygwEvents = Number(payrollAgg.rows[0]?.event_count ?? 0);
    const lastPayrollTs = payrollAgg.rows[0]?.last_event_ts || null;

    const gstExpected = asNumber(posAgg.rows[0]?.expected_gst_cents);
    const gstReported = asNumber(posAgg.rows[0]?.reported_gst_cents);
    const gstEvents = Number(posAgg.rows[0]?.event_count ?? 0);
    const lastPosTs = posAgg.rows[0]?.last_event_ts || null;

    await client.query(
      `INSERT INTO recon_inputs (
         abn, period_id,
         paygw_expected_cents, paygw_reported_cents,
         gst_expected_cents, gst_reported_cents,
         payroll_event_count, pos_event_count,
         last_payroll_event_ts, last_pos_event_ts,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (abn, period_id) DO UPDATE SET
         paygw_expected_cents = EXCLUDED.paygw_expected_cents,
         paygw_reported_cents = EXCLUDED.paygw_reported_cents,
         gst_expected_cents = EXCLUDED.gst_expected_cents,
         gst_reported_cents = EXCLUDED.gst_reported_cents,
         payroll_event_count = EXCLUDED.payroll_event_count,
         pos_event_count = EXCLUDED.pos_event_count,
         last_payroll_event_ts = EXCLUDED.last_payroll_event_ts,
         last_pos_event_ts = EXCLUDED.last_pos_event_ts,
         updated_at = NOW()`,
      [
        abn,
        periodId,
        paygwExpected,
        paygwReported,
        gstExpected,
        gstReported,
        paygwEvents,
        gstEvents,
        lastPayrollTs,
        lastPosTs
      ]
    );

    const paygwDelta = paygwReported - paygwExpected;
    const gstDelta = gstReported - gstExpected;
    const paygwPass = Math.abs(paygwDelta) <= tolerance;
    const gstPass = Math.abs(gstDelta) <= tolerance;
    const ok = paygwPass && gstPass;

    const nextState = ok ? "CLOSING" : "BLOCKED_DISCREPANCY";

    await client.query(
      `UPDATE periods
         SET accrued_cents = $3,
             final_liability_cents = $4,
             state = CASE
               WHEN state IN ('OPEN','CLOSING','BLOCKED_DISCREPANCY','BLOCKED_ANOMALY') THEN $5
               ELSE state
             END
       WHERE abn = $1 AND period_id = $2 AND tax_type = 'PAYGW'`,
      [abn, periodId, paygwExpected, paygwReported, nextState]
    );

    await client.query(
      `UPDATE periods
         SET accrued_cents = $3,
             final_liability_cents = $4,
             state = CASE
               WHEN state IN ('OPEN','CLOSING','BLOCKED_DISCREPANCY','BLOCKED_ANOMALY') THEN $5
               ELSE state
             END
       WHERE abn = $1 AND period_id = $2 AND tax_type = 'GST'`,
      [abn, periodId, gstExpected, gstReported, nextState]
    );

    const result: ReconResult = {
      schema: "recon.v1.result",
      abn,
      period_id: periodId,
      generated_at: new Date().toISOString(),
      tolerance_cents: tolerance,
      ok,
      state: nextState,
      paygw: {
        expected_cents: paygwExpected,
        reported_cents: paygwReported,
        delta_cents: paygwDelta,
        event_count: paygwEvents
      },
      gst: {
        expected_cents: gstExpected,
        reported_cents: gstReported,
        delta_cents: gstDelta,
        event_count: gstEvents
      }
    };

    await appendAudit("recon", "recon.v1.result", result);

    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
