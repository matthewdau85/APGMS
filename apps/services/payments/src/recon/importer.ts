import type { PoolClient } from 'pg';

export interface ReconImportParams {
  abn: string;
  taxType: string;
  periodId: string;
  manifestSha256: string;
  gateState: string;
}

export async function recordReconImport(client: PoolClient, params: ReconImportParams) {
  const sql = `
    INSERT INTO recon_imports (abn, tax_type, period_id, manifest_sha256, gate_state, imported_at)
    VALUES ($1,$2,$3,$4,$5, now())
    ON CONFLICT (abn, tax_type, period_id)
    DO UPDATE SET
      manifest_sha256 = EXCLUDED.manifest_sha256,
      gate_state = EXCLUDED.gate_state,
      imported_at = now()
    RETURNING manifest_sha256, gate_state
  `;
  const { rows } = await client.query(sql, [
    params.abn,
    params.taxType,
    params.periodId,
    params.manifestSha256,
    params.gateState,
  ]);
  return rows[0];
}
