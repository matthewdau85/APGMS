import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool";

type HeadersRecord = Record<string, string | string[]>;

function normaliseHeaders(headers: NodeJS.Dict<number | string | string[]>) {
  const entries = Object.entries(headers).map(([key, value]) => {
    if (Array.isArray(value)) return [key, value.map((v) => String(v))];
    return [key, String(value)];
  });
  return Object.fromEntries(entries) as HeadersRecord;
}

export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();

    const bodyHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(req.body ?? null))
      .digest("hex");
    const requestHash = crypto
      .createHash("sha256")
      .update([req.method, req.originalUrl || req.url, bodyHash].join("|"))
      .digest("hex");

    const inserted = await pool.query(
      `INSERT INTO idempotency_keys(key, method, path, request_hash, created_at)
       VALUES ($1,$2,$3,$4, NOW())
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, req.method, req.originalUrl || req.url, requestHash]
    );

    if (inserted.rowCount === 0) {
      const { rows } = await pool.query(
        `SELECT request_hash, status_code, response_body, response_headers
           FROM idempotency_keys
          WHERE key = $1`,
        [key]
      );
      const existing = rows[0];
      if (!existing) {
        return res.status(409).json({ error: "IDEMPOTENCY_KEY_REPLAY" });
      }
      if (existing.request_hash && existing.request_hash !== requestHash) {
        return res.status(409).json({ error: "IDEMPOTENCY_KEY_MISMATCH" });
      }
      if (existing.status_code == null) {
        res.setHeader("Retry-After", "1");
        return res.status(425).json({ error: "PENDING" });
      }
      if (existing.response_headers) {
        Object.entries(existing.response_headers as HeadersRecord).forEach(([k, v]) => {
          res.setHeader(k, v as string | string[]);
        });
      }
      return res.status(existing.status_code).json(existing.response_body ?? {});
    }

    const persistResponse = async (body: any) => {
      try {
        await pool.query(
          `UPDATE idempotency_keys
              SET status_code = $2,
                  response_body = $3,
                  response_headers = $4,
                  completed_at = NOW()
            WHERE key = $1`,
          [key, res.statusCode, body, normaliseHeaders(res.getHeaders())]
        );
      } catch (error) {
        console.error("[idempotency] failed to persist response", error);
      }
    };

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      void persistResponse(body);
      return originalJson(body);
    };

    const originalSend = res.send.bind(res);
    res.send = (body: any) => {
      let parsed: any = body;
      if (typeof body === "string") {
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
      }
      void persistResponse(parsed);
      return originalSend(body);
    };

    return next();
  };
}
