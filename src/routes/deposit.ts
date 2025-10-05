import { Router } from "express";
import { getPool } from "../db/pool";
export const router = Router();

router.post("/", async (req, res) => {
  const { abn, amount, source, idempotencyKey, period_id } = req.body ?? {};
  if (!abn || !amount || !idempotencyKey) {
    return res.status(400).json({ error: "abn, amount, idempotencyKey required" });
  }
  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const idem = await c.query(`select id from idempotency where key = $1 for update`, [idempotencyKey]);
    if (idem.rowCount) { await c.query("ROLLBACK"); return res.json({ ok: true, idempotent: true }); }

    await c.query(
      `insert into ledger (abn, period_id, direction, amount_cents, source, meta)
       values ($1, $2, 'credit', $3, $4, $5)`,
      [abn, period_id ?? null, Math.round(Number(amount) * 100), source || "deposit", { idempotencyKey }]
    );
    await c.query(`insert into idempotency (key, seen_at) values ($1, now())`, [idempotencyKey]);
    await c.query("COMMIT");
    res.json({ ok: true });
  } catch (e:any) {
    await c.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally { c.release(); }
});
