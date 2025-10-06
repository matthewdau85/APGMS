import { createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { sql } from "../db/sql";

export interface IdempotencyRecord {
  statusCode: number;
  body: unknown;
}

export interface IdempotencyStore {
  load(requestHash: string): Promise<IdempotencyRecord | null>;
  reserve(requestHash: string): Promise<boolean>;
  save(requestHash: string, record: IdempotencyRecord): Promise<void>;
}

const dbStore: IdempotencyStore = {
  async load(requestHash) {
    const query = sql`SELECT response_json FROM idempotency_keys WHERE request_hash=${requestHash}`;
    const { rows } = await pool.query(query.text, query.params);
    return rows[0]?.response_json ?? null;
  },
  async reserve(requestHash) {
    const query = sql`
      INSERT INTO idempotency_keys(request_hash,response_json,created_at)
      VALUES (${requestHash},${null},now())
      ON CONFLICT (request_hash) DO NOTHING
      RETURNING request_hash
    `;
    const { rows } = await pool.query(query.text, query.params);
    return rows.length > 0;
  },
  async save(requestHash, record) {
    const query = sql`
      UPDATE idempotency_keys SET response_json=${record}
       WHERE request_hash=${requestHash}
    `;
    await pool.query(query.text, query.params);
  },
};

function computeHash(req: Request, key: string) {
  const payload = JSON.stringify({
    key,
    method: req.method,
    url: req.originalUrl || req.url,
    body: req.body ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function idempotency(store: IdempotencyStore = dbStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST") return next();
    const key = req.header("Idempotency-Key");
    if (!key) return next();

    const requestHash = computeHash(req, key);
    const existing = await store.load(requestHash);
    if (existing) {
      res.setHeader("Idempotent-Replay", "true");
      res.status(existing.statusCode);
      return res.json(existing.body);
    }

    const reserved = await store.reserve(requestHash);
    if (!reserved) {
      const replay = await store.load(requestHash);
      if (replay) {
        res.setHeader("Idempotent-Replay", "true");
        res.status(replay.statusCode);
        return res.json(replay.body);
      }
    }

    const recordResponse = async (body: any) => {
      try {
        await store.save(requestHash, { statusCode: res.statusCode, body });
      } catch (err) {
        console.error("Failed to persist idempotent response", err);
      }
    };

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      void recordResponse(body);
      return originalJson(body);
    };

    const originalSend = res.send.bind(res);
    res.send = (body: any) => {
      void recordResponse(body);
      return originalSend(body);
    };

    return next();
  };
}

export { dbStore as __dbIdempotencyStore };
