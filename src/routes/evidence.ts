import { Router } from "express";
import { getPool } from "../db/pool";

export const router = Router();

// GET /api/evidence/:abn/:pid
router.get("/:abn/:pid", async (req, res) => {
  const { abn, pid } = req.params;
  const q = await getPool().query(
    `select abn, period_id, rpt_token, delta_cents, tolerance_bps, details, created_at
       from evidence_bundles
      where abn = $1 and period_id = $2
      order by created_at desc
      limit 1`,
    [abn, pid]
  );
  if (!q.rowCount) return res.status(404).json({ error: "not found" });
  res.json(q.rows[0]);
});
