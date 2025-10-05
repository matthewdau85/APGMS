import { Router } from "express";
import { getPool } from "../db/pool";
export const router = Router();

router.post("/webhook", async (req, res) => {
  const { abn, period_id, settlementRef, paidAt, amountCents, channel } = req.body ?? {};
  if (!abn || !period_id || !settlementRef || !paidAt || amountCents == null) {
    return res.status(400).json({ error: "missing fields" });
  }
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `insert into settlements (abn, period_id, settlement_ref, paid_at, amount_cents, channel, created_at)
       values ($1,$2,$3,$4,$5,$6, now())`,
      [abn, period_id, settlementRef, paidAt, amountCents, channel || null]
    );
    await c.query(
      `update evidence_bundles
         set details = jsonb_set(
           coalesce(details,'{}'::jsonb),
           '{settlement}',
           to_jsonb($1::json)
         )
       where abn=$2 and period_id=$3
       order by created_at desc
       limit 1`,
      [{ settlementRef, paidAt, amountCents, channel }, abn, period_id]
    );
    await c.query("COMMIT");
    res.json({ ok: true });
  } catch (e:any) { await c.query("ROLLBACK"); res.status(500).json({ error: e.message }); }
  finally { c.release(); }
});
