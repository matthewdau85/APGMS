import { Router } from "express";
import { getPool } from "../db/pool";
export const router = Router();

router.get("/:abn", async (req, res) => {
  const { abn } = req.params;
  const q = await getPool().query(
    `select coalesce(sum(case when direction='credit' then amount_cents else -amount_cents end),0) as cents
       from ledger where abn = $1`,
    [abn]
  );
  res.json({ abn, balance: Number(q.rows[0]?.cents ?? 0) / 100 });
});
