import { query } from "../persistence/db";
/** Express middleware for idempotency via Idempotency-Key header */
export function idempotency() {
  return async (req: any, res: any, next: any) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();
    try {
      await query("INSERT INTO idempotency_keys(key,last_status) VALUES($1,$2)", [key, "INIT"]);
      return next();
    } catch {
      const r = await query<{ last_status: string | null; response_hash: string | null }>(
        "SELECT last_status, response_hash FROM idempotency_keys WHERE key=$1",
        [key],
      );
      return res.status(200).json({ idempotent: true, status: r.rows[0]?.last_status || "DONE" });
    }
  };
}
