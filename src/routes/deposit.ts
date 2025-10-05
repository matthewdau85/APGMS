import { Router } from "express";
import { getPool } from "../db/pool";

export const router = Router();

// POST /api/deposit { abn, amount, source, idempotencyKey }
router.post("/", async (req, res) => {
  const { abn, amount, source, idempotencyKey } = req.body ?? {};
  if (!abn || !amount || !idempotencyKey) {
    return res.status(400).json({ error: "abn, amount, idempotencyKey required" });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // enforce idempotency
    const idem = await client.query(
      `select id from idempotency where key = $1 for update`,
      [idempotencyKey]
    );
    if (idem.rowCount && idem.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(200).json({ ok: true, idempotent: true });
    }

    await client.query(
      `insert into ledger (abn, direction, amount_cents, source, meta)
       values ($1, 'credit', $2, $3, $4)`,
      [abn, Math.round(Number(amount) * 100), source || "deposit", { idempotencyKey }]
    );

    await client.query(
      `insert into idempotency (key, seen_at) values ($1, now())`,
      [idempotencyKey]
    );

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (e: any) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});
