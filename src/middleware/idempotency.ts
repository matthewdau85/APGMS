import { NextFunction, Request, Response } from "express";

import { pool } from "../db/pool";

export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();
    try {
      await pool.query("INSERT INTO idempotency_keys(key,last_status) VALUES($1,$2)", [key, "INIT"]);
      return next();
    } catch {
      const existing = await pool.query(
        "SELECT last_status, response_hash FROM idempotency_keys WHERE key=$1",
        [key]
      );
      return res.status(200).json({
        idempotent: true,
        status: existing.rows[0]?.last_status || "DONE",
        response_hash: existing.rows[0]?.response_hash ?? null,
      });
    }
  };
}
