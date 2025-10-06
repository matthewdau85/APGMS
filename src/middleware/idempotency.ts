import { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { pool } from "../db/pool";

type StoredOutcome = {
  statusCode: number;
  body: unknown;
  json: boolean;
};

const RETRY_AFTER_SECONDS = "1";

export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("Idempotency-Key");
    if (!key) {
      return next();
    }

    const requestHash = crypto
      .createHash("sha256")
      .update(`${req.method}:${req.originalUrl}:${key}`)
      .digest("hex");

    try {
      const inserted = await pool.query(
        `INSERT INTO idempotency_keys (request_hash, key, method, path, first_seen_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (request_hash) DO NOTHING
         RETURNING request_hash`,
        [requestHash, key, req.method, req.originalUrl]
      );

      if (inserted.rowCount === 0) {
        const existing = await pool.query<{ outcome: StoredOutcome | null }>(
          "SELECT outcome FROM idempotency_keys WHERE request_hash=$1",
          [requestHash]
        );
        const outcome = existing.rows[0]?.outcome;
        if (outcome && typeof outcome.statusCode === "number") {
          res.setHeader("Idempotent-Replay", "true");
          res.status(outcome.statusCode);
          return outcome.json
            ? res.json(outcome.body)
            : res.send(outcome.body as string);
        }
        res.setHeader("Retry-After", RETRY_AFTER_SECONDS);
        return res.status(409).json({ error: "IDEMPOTENCY_IN_PROGRESS" });
      }
    } catch (error) {
      return next(error);
    }

    let captured = false;
    let body: unknown;
    let usedJson = false;

    const originalStatus = res.status.bind(res);
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.status = (code: number) => {
      res.locals.__idempotencyStatus = code;
      return originalStatus(code);
    };

    res.json = (payload: unknown) => {
      captured = true;
      usedJson = true;
      body = payload;
      return originalJson(payload);
    };

    res.send = (payload: unknown) => {
      captured = true;
      usedJson = false;
      body = payload;
      return originalSend(payload);
    };

    res.on("finish", async () => {
      if (!captured) return;
      if (res.statusCode >= 500) return;
      const statusCode = res.locals.__idempotencyStatus ?? res.statusCode;
      try {
        await pool.query(
          "UPDATE idempotency_keys SET outcome=$1 WHERE request_hash=$2",
          [
            {
              statusCode,
              body,
              json: usedJson,
            },
            requestHash,
          ]
        );
      } catch (error) {
        console.error("Failed to persist idempotency outcome", error);
      }
    });

    return next();
  };
}
