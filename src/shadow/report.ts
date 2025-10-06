import { getPool } from "../db/pool";

const pool = getPool();

export interface ShadowReportOptions {
  from?: Date;
  to?: Date;
  operation?: string;
}

export interface ShadowReportSummary {
  from?: string | null;
  to?: string | null;
  operation?: string | null;
  total: number;
  mismatch_count: number;
  mismatch_rate: number;
  p95_latency_delta_ms: number | null;
}

export async function getShadowReport(options: ShadowReportOptions = {}): Promise<ShadowReportSummary> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (options.from) {
    conditions.push(`created_at >= $${params.length + 1}`);
    params.push(options.from.toISOString());
  }
  if (options.to) {
    conditions.push(`created_at <= $${params.length + 1}`);
    params.push(options.to.toISOString());
  }
  if (options.operation) {
    conditions.push(`operation = $${params.length + 1}`);
    params.push(options.operation);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT status_mismatch, body_mismatch, latency_delta_ms FROM shadow_observations ${where} ORDER BY created_at ASC`,
    params
  );

  const total = rows.length;
  const mismatchCount = rows.filter((row: any) => row.status_mismatch || row.body_mismatch).length;
  const mismatchRate = total === 0 ? 0 : mismatchCount / total;

  const deltas = rows
    .map((row: any) => Math.abs(Number(row.latency_delta_ms ?? 0)))
    .filter((v: number) => Number.isFinite(v))
    .sort((a: number, b: number) => a - b);

  const p95 = deltas.length ? percentile(deltas, 0.95) : null;

  return {
    from: options.from ? options.from.toISOString() : null,
    to: options.to ? options.to.toISOString() : null,
    operation: options.operation ?? null,
    total,
    mismatch_count: mismatchCount,
    mismatch_rate: mismatchRate,
    p95_latency_delta_ms: p95,
  };
}

function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const rank = (values.length - 1) * pct;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return values[lower];
  }
  const weight = rank - lower;
  return values[lower] + (values[upper] - values[lower]) * weight;
}
