import type { PoolClient } from "pg";
import { query, pool, type Queryable } from "./db";

export type PeriodState =
  | "OPEN"
  | "CLOSING"
  | "READY_RPT"
  | "BLOCKED_ANOMALY"
  | "BLOCKED_DISCREPANCY"
  | "RELEASED"
  | "FINALIZED";

export interface PeriodRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  state: PeriodState;
  basis: string | null;
  accrued_cents: string | null;
  credited_to_owa_cents: string | null;
  final_liability_cents: string | null;
  merkle_root: string | null;
  running_balance_hash: string | null;
  anomaly_vector: any;
  thresholds: any;
  created_at: Date;
  updated_at: Date;
}

export interface ThresholdsInput {
  [key: string]: number;
}

export interface PeriodMetricsUpdate {
  accrued_cents?: bigint;
  credited_to_owa_cents?: bigint;
  final_liability_cents?: bigint;
  merkle_root?: string | null;
  running_balance_hash?: string | null;
  anomaly_vector?: Record<string, number>;
  thresholds?: ThresholdsInput;
}

export async function findPeriod(
  abn: string,
  taxType: string,
  periodId: string,
  client: Queryable = pool,
): Promise<PeriodRow | undefined> {
  const { rows } = await query<PeriodRow>(
    "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [abn, taxType, periodId],
    client,
  );
  return rows[0];
}

export async function lockPeriod(
  abn: string,
  taxType: string,
  periodId: string,
  client: PoolClient,
): Promise<PeriodRow | undefined> {
  const { rows } = await client.query<PeriodRow>(
    "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 FOR UPDATE",
    [abn, taxType, periodId],
  );
  return rows[0];
}

export async function updateState(
  id: number,
  nextState: PeriodState,
  client: Queryable = pool,
): Promise<void> {
  await query(
    "UPDATE periods SET state=$1, updated_at=NOW() WHERE id=$2",
    [nextState, id],
    client,
  );
}

export async function updateMetrics(
  abn: string,
  taxType: string,
  periodId: string,
  metrics: PeriodMetricsUpdate,
  client: Queryable = pool,
): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  for (const [key, value] of Object.entries(metrics)) {
    fields.push(`${key}=$${idx++}`);
    if (typeof value === "bigint") {
      values.push(value.toString());
    } else {
      values.push(value);
    }
  }
  if (fields.length === 0) return;
  values.push(abn, taxType, periodId);
  await query(
    `UPDATE periods SET ${fields.join(",")}, updated_at=NOW() WHERE abn=$${idx++} AND tax_type=$${idx++} AND period_id=$${idx}`,
    values,
    client,
  );
}

export interface TransitionRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  from_state: PeriodState;
  to_state: PeriodState;
  reason: string | null;
  metadata: any;
  created_at: Date;
}

export async function recordTransition(
  abn: string,
  taxType: string,
  periodId: string,
  fromState: PeriodState,
  toState: PeriodState,
  reason: string | null,
  metadata: Record<string, unknown> | null,
  client: Queryable = pool,
): Promise<void> {
  await query(
    `INSERT INTO period_transitions(abn,tax_type,period_id,from_state,to_state,reason,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [abn, taxType, periodId, fromState, toState, reason, metadata ?? {}],
    client,
  );
}

export async function averageLiability(
  abn: string,
  taxType: string,
  excludePeriodId: string,
  lookback: number,
  client: Queryable = pool,
): Promise<number | null> {
  const { rows } = await query<{ avg: string | null }>(
    `SELECT AVG(final_liability_cents)::numeric AS avg
       FROM (
         SELECT final_liability_cents
         FROM periods
         WHERE abn=$1 AND tax_type=$2 AND period_id <> $3
           AND final_liability_cents IS NOT NULL
         ORDER BY period_id DESC
         LIMIT $4
       ) t`,
    [abn, taxType, excludePeriodId, lookback],
    client,
  );
  const avg = rows[0]?.avg;
  return avg ? Number(avg) : null;
}

export async function listPeriodsNeedingReplay(
  client: Queryable = pool,
): Promise<PeriodRow[]> {
  const { rows } = await query<PeriodRow>(
    `SELECT * FROM periods
      WHERE merkle_root IS NULL
         OR anomaly_vector IS NULL
         OR anomaly_vector::text = '{}'::text
      ORDER BY updated_at DESC`,
    [],
    client,
  );
  return rows;
}

