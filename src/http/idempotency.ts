import { getPool } from "../db/pool";
import { Request, Response, NextFunction } from "express";

export async function idempotent(req: Request, res: Response, next: NextFunction) {
  const key = (req.headers["idempotency-key"] || req.body?.idempotencyKey) as string | undefined;
  if (!key) return next();
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    const q = await c.query(`select id from idempotency where key=$1 for update`, [key]);
    if (q.rowCount) { await c.query("ROLLBACK"); return res.status(200).json({ ok: true, idempotent: true }); }
    res.locals.__idem_key = key;
    res.locals.__idem_commit = async () => { await c.query(`insert into idempotency (key, seen_at) values ($1, now())`, [key]); await c.query("COMMIT"); c.release(); };
    next();
  } catch (e) { await c.query("ROLLBACK"); c.release(); next(e); }
}
