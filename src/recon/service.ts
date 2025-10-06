import { Pool } from "pg";
import { computeRecon, PayrollSnapshot, PosSnapshot, ReconInputs, ReconResult, ReconThresholds } from "./compute";
import { applyReconGateTransition } from "../gate/transition";

const pool = new Pool();

const DEFAULT_THRESHOLDS: ReconThresholds = {
  epsilon_cents: 100,
  variance_ratio: 0.05,
  delta_vs_baseline: 0.05,
};

function aggregatePayroll(rows: any[]): PayrollSnapshot | null {
  if (!rows.length) return null;
  return rows.reduce(
    (acc, row) => {
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      acc.w1 += Number(payload?.totals?.w1 ?? 0);
      acc.w2 += Number(payload?.totals?.w2 ?? 0);
      if (payload?.totals?.gross) acc.gross = (acc.gross ?? 0) + Number(payload.totals.gross);
      if (payload?.totals?.tax) acc.tax = (acc.tax ?? 0) + Number(payload.totals.tax);
      return acc;
    },
    { w1: 0, w2: 0 } as PayrollSnapshot
  );
}

function aggregatePos(rows: any[]): PosSnapshot | null {
  if (!rows.length) return null;
  return rows.reduce(
    (acc, row) => {
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      acc.g1 += Number(payload?.totals?.g1 ?? 0);
      acc.g10 += Number(payload?.totals?.g10 ?? 0);
      acc.g11 += Number(payload?.totals?.g11 ?? 0);
      acc.taxCollected += Number(payload?.totals?.taxCollected ?? 0);
      return acc;
    },
    { g1: 0, g10: 0, g11: 0, taxCollected: 0 } as PosSnapshot
  );
}

async function persistReconSnapshots(tenantId: string, taxType: string, periodId: string, inputs: ReconInputs) {
  await pool.query(
    "insert into recon_inputs(tenant_id, tax_type, period_id, payroll_snapshot, pos_snapshot) values ($1,$2,$3,$4,$5)",
    [tenantId, taxType, periodId, JSON.stringify(inputs.payroll ?? null), JSON.stringify(inputs.pos ?? null)]
  );
}

async function persistReconResult(tenantId: string, taxType: string, periodId: string, result: ReconResult) {
  await pool.query(
    "insert into recon_results(tenant_id, tax_type, period_id, status, deltas, reasons) values ($1,$2,$3,$4,$5,$6)",
    [tenantId, taxType, periodId, result.status, JSON.stringify(result.deltas), JSON.stringify(result.reasons)]
  );
  await pool.query(
    "insert into event_outbox(topic, payload) values ($1,$2)",
    [
      "recon.v1.result",
      JSON.stringify({ tenantId, taxType, periodId, status: result.status, deltas: result.deltas, reasons: result.reasons }),
    ]
  );
}

export async function runRecon(tenantId: string, taxType: string, periodId: string): Promise<ReconResult> {
  const payrollRows = (await pool.query("select payload from payroll_events where tenant_id=$1 and period_id=$2", [tenantId, periodId])).rows;
  const posRows = (await pool.query("select payload from pos_events where tenant_id=$1 and period_id=$2", [tenantId, periodId])).rows;

  const payroll = aggregatePayroll(payrollRows);
  const pos = aggregatePos(posRows);
  const inputs: ReconInputs = { payroll, pos };

  const period = await pool.query("select thresholds, state from periods where abn=$1 and tax_type=$2 and period_id=$3", [tenantId, taxType, periodId]);
  const periodThresholdsRaw = period.rows[0]?.thresholds;
  const thresholdObject =
    typeof periodThresholdsRaw === "string"
      ? JSON.parse(periodThresholdsRaw)
      : periodThresholdsRaw ?? {};
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...thresholdObject,
  } as ReconThresholds;

  const result = computeRecon(inputs, thresholds);
  await persistReconSnapshots(tenantId, taxType, periodId, inputs);
  await persistReconResult(tenantId, taxType, periodId, result);
  await applyReconGateTransition({ tenantId, taxType, periodId, result });
  return result;
}
