import { Router } from "express";
import { getPool } from "../db/pool";

export const router = Router();

// GET /api/balance/:abn
router.get("/:abn", async (req, res) => {
  const { abn } = req.params;
  const pool = getPool();
  const q = await pool.query(
    `select coalesce(sum(case when direction='credit' then amount_cents else -amount_cents end),0) as cents
     from ledger where abn = $1`,
    [abn]
  );
  const cents = Number(q.rows[0]?.cents ?? 0);
  res.json({ abn, balance: cents / 100 });
});
