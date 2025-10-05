import { Pool, PoolClient } from "pg";

const pool = new Pool();

export interface EvidenceBundleInput {
  abn: string;
  periodId: number;
  rptToken?: string;
  deltaCents: number;
  toleranceBps: number;
  details?: any;
}

export interface EvidenceBundleRow {
  id: number;
  abn: string;
  period_id: number;
  rpt_token: string | null;
  delta_cents: number;
  tolerance_bps: number;
  details: any;
  created_at: Date;
}

export async function saveEvidence(
  c: PoolClient,
  input: EvidenceBundleInput
): Promise<EvidenceBundleRow> {
  const details = input.details ?? {};
  const q = await c.query<EvidenceBundleRow>(
    `insert into evidence_bundles (abn, period_id, rpt_token, delta_cents, tolerance_bps, details)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      input.abn,
      input.periodId,
      input.rptToken ?? null,
      input.deltaCents,
      input.toleranceBps,
      details,
    ]
  );
  return q.rows[0];
}

export async function getLatestEvidenceBundle(
  abn: string,
  periodId: number
): Promise<EvidenceBundleRow | null> {
  const q = await pool.query<EvidenceBundleRow>(
    `select * from evidence_bundles
     where abn = $1 and period_id = $2
     order by created_at desc, id desc
     limit 1`,
    [abn, periodId]
  );
  return q.rows[0] ?? null;
}
