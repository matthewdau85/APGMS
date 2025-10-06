import { NextFunction, Request, Response } from "express";
import pool from "../db/pool.js";
import { sha256Hex } from "../crypto/merkle";

export const SQL_SELECT_IDEMPOTENCY_FOR_UPDATE = `
  SELECT key, status_code, response, last_status
    FROM idempotency_keys
   WHERE key = $1
   FOR UPDATE SKIP LOCKED
`;

export const SQL_INSERT_IDEMPOTENCY_KEY = `
  INSERT INTO idempotency_keys (key, last_status, request_id)
  VALUES ($1, $2, $3)
  ON CONFLICT (key) DO NOTHING
`;

export const SQL_UPDATE_IDEMPOTENCY_RESULT = `
  UPDATE idempotency_keys
     SET last_status = $2,
         status_code = $3,
         response = $4,
         response_hash = $5,
         request_id = COALESCE($6, request_id),
         updated_at = now()
   WHERE key = $1
`;

function classifyStatus(statusCode: number | undefined) {
  if (!statusCode) return "FAILED";
  if (statusCode >= 200 && statusCode < 400) return "DONE";
  return "FAILED";
}

export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();

    const requestId = (req as any).requestId ?? null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(SQL_SELECT_IDEMPOTENCY_FOR_UPDATE, [key]);
      if (existing.rowCount > 0) {
        const row = existing.rows[0];
        await client.query("COMMIT");
        res.setHeader("Idempotent-Replay", "true");
        if (row.response) {
          return res.status(200).json(row.response.body ?? row.response);
        }
        return res.status(409).json({ error: "IN_PROGRESS", idempotencyKey: key });
      }
      await client.query(SQL_INSERT_IDEMPOTENCY_KEY, [key, "IN_PROGRESS", requestId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      return next(err);
    } finally {
      client.release();
    }

    let finalised = false;
    const persist = async (body: any) => {
      if (finalised) return;
      finalised = true;
      const statusCode = res.statusCode;
      const payload = { statusCode, body };
      try {
        await pool.query(SQL_UPDATE_IDEMPOTENCY_RESULT, [
          key,
          classifyStatus(statusCode),
          statusCode || null,
          payload,
          sha256Hex(JSON.stringify(payload)),
          requestId
        ]);
      } catch (error) {
        console.error("Failed to persist idempotency result", error);
      }
    };

    const originalJson = res.json.bind(res);
    res.json = (body?: any) => {
      void persist(body);
      return originalJson(body);
    };

    const originalSend = res.send.bind(res);
    res.send = (body?: any) => {
      void persist(body);
      return originalSend(body);
    };

    res.once("finish", () => {
      void persist(null);
    });

    next();
  };
}
