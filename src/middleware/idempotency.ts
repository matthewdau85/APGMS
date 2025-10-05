import { Pool } from "pg";
const pool = new Pool();
/** Express middleware for idempotency via Idempotency-Key header */
export function idempotency() {
  return async (req:any, res:any, next:any) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();
    try {
      await pool.query("insert into idempotency_keys(key,last_status) values($1,$2)", [key, "INIT"]);
      return next();
    } catch (err: any) {
      if (err?.code === "23505") {
        const r = await pool.query(
          "select last_status, response_hash from idempotency_keys where key=$1",
          [key]
        );
        return res.status(409).json({
          error: "IDEMPOTENCY_CONFLICT",
          key,
          last_status: r.rows[0]?.last_status ?? null,
          response_hash: r.rows[0]?.response_hash ?? null
        });
      }
      return next(err);
    }
  };
}
