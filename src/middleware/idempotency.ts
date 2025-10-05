import { getPool } from "../db/pool";
/** Express middleware for idempotency via `Idempotency-Key` header */
export function idempotency() {
  return async (req:any, res:any, next:any) => {
    const pool = getPool();
    const key = req.header("Idempotency-Key");
    if (!key) return next();
    try {
      await pool.query("insert into idempotency_keys(key,last_status) values(,)", [key, "INIT"]);
      return next();
    } catch {
      const r = await pool.query("select last_status, response_hash from idempotency_keys where key=", [key]);
      return res.status(200).json({ idempotent:true, status: r.rows[0]?.last_status || "DONE" });
    }
  };
}
