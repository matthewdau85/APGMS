import { getPool } from "../db/pool";

export interface ProviderObservation {
  status: number;
  body: any;
  latencyMs: number;
}

interface RecordArgs {
  traceId: string;
  operation: string;
  mock: ProviderObservation;
  real: ProviderObservation;
}

const pool = getPool();

function cloneBody(body: any) {
  if (body === null || body === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(body));
  } catch {
    return body;
  }
}

export async function recordShadowObservation({ traceId, operation, mock, real }: RecordArgs) {
  const mockBody = cloneBody(mock.body);
  const realBody = cloneBody(real.body);
  const statusMismatch = mock.status !== real.status;
  const bodyMismatch = JSON.stringify(mockBody) !== JSON.stringify(realBody);
  const latencyDelta = Number(real.latencyMs ?? 0) - Number(mock.latencyMs ?? 0);

  await pool.query(
    `INSERT INTO shadow_observations
      (trace_id, operation, mock_status, real_status, mock_body, real_body,
       mock_latency_ms, real_latency_ms, latency_delta_ms, status_mismatch, body_mismatch)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      traceId,
      operation,
      mock.status,
      real.status,
      mockBody,
      realBody,
      Number(mock.latencyMs ?? 0),
      Number(real.latencyMs ?? 0),
      latencyDelta,
      statusMismatch,
      bodyMismatch,
    ]
  );
}
