import { Pool } from "pg";
import { sha256Hex } from "../crypto/merkle";
const pool = new Pool();
/** Express middleware for idempotency via Idempotency-Key header */
export function idempotency() {
  return async (req: any, res: any, next: any) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();
    try {
      await pool.query("INSERT INTO idempotency_keys(key,last_status) VALUES ($1,$2)", [key, "INIT"]);
    } catch {
      const r = await pool.query(
        "SELECT last_status, response_hash FROM idempotency_keys WHERE key=$1",
        [key]
      );
      const row = r.rows[0];
      return res.status(200).json({
        idempotent: true,
        status: row?.last_status || "DONE",
        response_hash: row?.response_hash || null,
      });
    }

    res.locals.idempotencyKey = key;
    res.locals.completeIdempotency = async (status: string, body: any) => {
      const hash = sha256Hex(JSON.stringify(body ?? null));
      await pool.query(
        "UPDATE idempotency_keys SET last_status=$1, response_hash=$2 WHERE key=$3",
        [status, hash, key]
      );
      return hash;
    };
    return next();
  };
}
