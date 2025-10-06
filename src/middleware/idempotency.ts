import { Pool } from "pg";

const pool = new Pool();

interface IdempotencyReplay {
  last_status: string | null;
  response_hash: string | null;
}

interface IdempotencyRequest {
  idempotencyKey?: string;
  idempotencyReplay?: IdempotencyReplay | null;
  idempotencyDuplicate?: boolean;
}

/** Express middleware for idempotency via Idempotency-Key header */
export function idempotency() {
  return async (req: IdempotencyRequest & any, _res: any, next: any) => {
    const headerFn: ((name: string) => string | undefined) | undefined =
      typeof req.header === "function" ? req.header.bind(req) :
      typeof req.get === "function" ? req.get.bind(req) :
      undefined;

    const key = headerFn ? headerFn("Idempotency-Key") : undefined;
    if (!key) return next();

    req.idempotencyKey = key;
    try {
      await pool.query("insert into idempotency_keys(key,last_status) values($1,$2)", [key, "INIT"]);
      req.idempotencyDuplicate = false;
      return next();
    } catch {
      const r = await pool.query(
        "select last_status, response_hash from idempotency_keys where key=$1",
        [key]
      );
      req.idempotencyReplay = r.rows[0] || null;
      req.idempotencyDuplicate = true;
      return next();
    }
  };
}
