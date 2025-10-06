import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { pool } from "../db/pool";
import {
  insertIdempotencyKey,
  selectIdempotencyKey,
  updateIdempotencyOutcome,
} from "../db/queries";

export interface StoredIdempotencyRecord {
  key: string;
  request_hash: string;
  response_status: number | null;
  response_body: unknown | null;
  outcome: string | null;
  updated_at: Date | null;
}

export type ReserveState = "new" | "replay" | "conflict" | "pending";

export interface ReserveResult {
  state: ReserveState;
  record?: StoredIdempotencyRecord;
}

export interface IdempotencyStore {
  reserve(key: string, requestHash: string, scope: string): Promise<ReserveResult>;
  save(key: string, responseStatus: number, responseBody: unknown, outcome: string): Promise<void>;
}

export const pgIdempotencyStore: IdempotencyStore = {
  async reserve(key, requestHash, scope) {
    const inserted = await pool.query(insertIdempotencyKey(key, requestHash, scope));
    if (inserted.rowCount > 0) {
      return { state: "new" };
    }
    const existing = await pool.query(selectIdempotencyKey(key));
    if (existing.rowCount === 0) {
      return { state: "pending" };
    }
    const record = existing.rows[0] as StoredIdempotencyRecord;
    if (record.request_hash !== requestHash) {
      return { state: "conflict", record };
    }
    if (record.response_status != null) {
      return { state: "replay", record };
    }
    return { state: "pending", record };
  },

  async save(key, responseStatus, responseBody, outcome) {
    await pool.query(updateIdempotencyOutcome(key, responseStatus, responseBody, outcome));
  },
};

function computeRequestHash(req: Request) {
  const payload = {
    method: req.method,
    url: req.originalUrl || req.url,
    body: req.body ?? null,
  };
  const serialized = JSON.stringify(payload);
  return createHash("sha256").update(serialized).digest("hex");
}

type CaptureMode = "json" | "send" | null;

function normaliseSendBody(body: any) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) {
    return { __kind: "send", type: "buffer", data: body.toString("base64") };
  }
  if (typeof body === "string") {
    return { __kind: "send", type: "text", data: body };
  }
  return { __kind: "send", type: "json", data: body };
}

function restoreBody(stored: any) {
  if (!stored || typeof stored !== "object" || stored.__kind !== "send") {
    return stored;
  }
  if (stored.type === "buffer" && typeof stored.data === "string") {
    return Buffer.from(stored.data, "base64");
  }
  if (stored.type === "text" && typeof stored.data === "string") {
    return stored.data;
  }
  return stored.data;
}

function captureResponse(res: Response) {
  let capturedBody: unknown = null;
  let captured = false;
  let mode: CaptureMode = null;

  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    captured = true;
    capturedBody = body;
    mode = "json";
    return originalJson(body);
  };

  const originalSend = res.send.bind(res);
  res.send = function send(body: any) {
    captured = true;
    capturedBody = normaliseSendBody(body);
    mode = "send";
    return originalSend(body);
  } as Response["send"];

  return () => ({
    captured,
    body: capturedBody,
    status: res.statusCode,
    mode,
  });
}

export function idempotency(store: IdempotencyStore = pgIdempotencyStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();

    const scope = `${req.method}:${req.originalUrl || req.url}`;
    const requestHash = computeRequestHash(req);

    const reservation = await store.reserve(key, requestHash, scope);

    if (reservation.state === "conflict") {
      return res.status(409).json({ error: "IDEMPOTENCY_KEY_MISMATCH" });
    }

    if (reservation.state === "replay" && reservation.record) {
      const rawBody = reservation.record.response_body;
      const restored = restoreBody(rawBody);
      res.setHeader("Idempotent-Replay", "true");
      const status = reservation.record.response_status ?? 200;
      if (rawBody && typeof rawBody === "object" && (rawBody as any).__kind === "send") {
        return res.status(status).send(restored);
      }
      return res.status(status).json(restored ?? {});
    }

    if (reservation.state === "pending") {
      return res.status(409).json({ error: "IDEMPOTENCY_KEY_PENDING" });
    }

    const finish = captureResponse(res);

    res.once("finish", async () => {
      const { captured, body, status, mode } = finish();
      const statusCode = status ?? 500;
      const outcome = statusCode >= 200 && statusCode < 400 ? "SUCCESS" : "ERROR";
      if (!captured) {
        // Nothing intercepted (e.g. stream) – store a placeholder so duplicates know it finished.
        await store.save(key, statusCode, null, outcome);
      } else {
        if (mode === "send") {
          await store.save(key, statusCode, body, outcome);
        } else {
          await store.save(key, statusCode, body, outcome);
        }
      }
    });

    return next();
  };
}

export default idempotency;
