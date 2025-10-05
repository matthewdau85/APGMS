import type { Request, Response, NextFunction } from "express";
import { q } from "../db";

export const SQL_INSERT_IDEMPOTENCY_KEY =
  "INSERT INTO idempotency_keys(key,last_status) VALUES ($1,$2)";
export const SQL_SELECT_IDEMPOTENCY_KEY =
  "SELECT last_status, response_hash FROM idempotency_keys WHERE key=$1";

/** Express middleware for idempotency via Idempotency-Key header */
export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();
    try {
      await q(SQL_INSERT_IDEMPOTENCY_KEY, [key, "INIT"]);
      return next();
    } catch (err: any) {
      const r = await q(SQL_SELECT_IDEMPOTENCY_KEY, [key]);
      return res
        .status(200)
        .json({ idempotent: true, status: r.rows[0]?.last_status || "DONE" });
    }
  };
}
