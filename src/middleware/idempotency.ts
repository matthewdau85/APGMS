// src/middleware/idempotency.ts
// Import the PostgreSQL connection pool so we can persist idempotency records.
import { Pool } from "pg";
// Instantiate a single pool instance that all middleware invocations will share.
const pool = new Pool();
// ---
// Export a factory that produces the Express middleware enforcing idempotency.
export function idempotency() {
  // Return the actual middleware function that Express will invoke per request.
  return async (req: any, res: any, next: any) => {
    // Read the Idempotency-Key header which uniquely identifies repeated requests.
    const key = req.header("Idempotency-Key");
    // If there is no key we simply continue to the next middleware immediately.
    if (!key) return next();
    // Try to insert a brand-new idempotency record to claim this key for the first time.
    try {
      // Persist the key and mark the status as INIT so future requests know it is in-flight.
      await pool.query("insert into idempotency_keys(key,last_status) values(,)", [key, "INIT"]);
      // Allow the request to proceed down the pipeline now that the key is recorded.
      return next();
    } catch {
      // If the insert fails we assume the key already exists and fetch the stored response metadata.
      const r = await pool.query("select last_status, response_hash from idempotency_keys where key=", [key]);
      // Return a 200 OK response noting that this call is idempotent and providing the last known status.
      return res.status(200).json({ idempotent: true, status: r.rows[0]?.last_status || "DONE" });
    }
    // End of middleware function.
  };
  // End of idempotency factory.
}
