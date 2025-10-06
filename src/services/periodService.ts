import type { PoolClient } from "pg";
import {
  PeriodState,
  findPeriod,
  lockPeriod,
  recordTransition,
  updateState,
  updateMetrics,
  type PeriodMetricsUpdate,
} from "../persistence/periodsRepository";
import { withTransaction } from "../persistence/db";

const allowedTransitions: Record<PeriodState, PeriodState[]> = {
  OPEN: ["CLOSING"],
  CLOSING: ["READY_RPT", "BLOCKED_ANOMALY", "BLOCKED_DISCREPANCY"],
  READY_RPT: ["RELEASED", "BLOCKED_ANOMALY", "BLOCKED_DISCREPANCY"],
  BLOCKED_ANOMALY: ["CLOSING"],
  BLOCKED_DISCREPANCY: ["CLOSING"],
  RELEASED: ["FINALIZED"],
  FINALIZED: [],
};

export async function ensureTransition(
  abn: string,
  taxType: string,
  periodId: string,
  nextState: PeriodState,
  reason: string | null = null,
  metadata: Record<string, unknown> | null = null,
  client?: PoolClient,
): Promise<void> {
  const perform = async (tx: PoolClient) => {
    const period = await lockPeriod(abn, taxType, periodId, tx);
    if (!period) throw new Error("PERIOD_NOT_FOUND");
    if (period.state === nextState) {
      await recordTransition(abn, taxType, periodId, period.state, nextState, reason, metadata, tx);
      return;
    }
    const allowed = allowedTransitions[period.state] ?? [];
    if (!allowed.includes(nextState)) {
      throw new Error(`INVALID_TRANSITION:${period.state}->${nextState}`);
    }
    await updateState(period.id, nextState, tx);
    await recordTransition(abn, taxType, periodId, period.state, nextState, reason, metadata, tx);
  };
  if (client) {
    await perform(client);
  } else {
    await withTransaction(perform);
  }
}

export async function updatePeriodMetrics(
  abn: string,
  taxType: string,
  periodId: string,
  metrics: PeriodMetricsUpdate,
): Promise<void> {
  await updateMetrics(abn, taxType, periodId, metrics);
}

export async function getPeriod(abn: string, taxType: string, periodId: string) {
  return findPeriod(abn, taxType, periodId);
}

