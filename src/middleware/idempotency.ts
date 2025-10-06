import { Pool } from "pg";
const pool = new Pool();
/** Express middleware for idempotency via Idempotency-Key header */
export function idempotency() {
  return async (req:any, res:any, next:any) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();
    (req as any).idempotencyKey = key;
    try {
      await pool.query("insert into idempotency_keys(key,last_status) values($1,$2)", [key, "INIT"]);
      return next();
    } catch {
      const r = await pool.query("select last_status, response_hash from idempotency_keys where key=$1", [key]);
      (req as any).idempotencyReplay = r.rows[0] || null;
      return next();
    }
  };
}
