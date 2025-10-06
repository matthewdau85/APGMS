import express from "express";
import { Pool } from "pg";

export const api = express.Router();

const pool = new Pool();

api.get("/recon/queue", async (req, res) => {
  const tenantId = req.query.tenantId as string;
  if (!tenantId) {
    return res.status(400).json({ error: "tenantId required" });
  }
  const limit = Math.min(Number(req.query.limit ?? 25) || 25, 100);
  const results = await pool.query(
    "select tax_type, period_id, status, deltas, reasons, created_at from recon_results where tenant_id=$1 order by created_at desc limit $2",
    [tenantId, limit]
  );
  const states = await pool.query(
    "select tax_type, period_id, state from periods where abn=$1",
    [tenantId]
  );
  const stateMap = new Map<string, string>();
  for (const row of states.rows) {
    stateMap.set(`${row.tax_type}:${row.period_id}`, row.state);
  }
  const periods = results.rows.map((row) => ({
    taxType: row.tax_type,
    periodId: row.period_id,
    status: row.status,
    reasons: typeof row.reasons === "string" ? JSON.parse(row.reasons) : row.reasons,
    deltas: typeof row.deltas === "string" ? JSON.parse(row.deltas) : row.deltas,
    createdAt: row.created_at,
    state: stateMap.get(`${row.tax_type}:${row.period_id}`) ?? null,
  }));

  const dlqRows = await pool.query(
    "select id, endpoint, reason, created_at from ingest_dlq where tenant_id is null or tenant_id=$1 order by created_at desc limit 50",
    [tenantId]
  );
  res.json({ periods, dlq: dlqRows.rows });
});
