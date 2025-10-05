import type { NextFunction, Request, Response } from "express";
import { createHash } from "crypto";
import { Pool } from "pg";

type IdempotencyRecord = {
  key: string;
  request_hash: string | null;
  last_status: string | null;
  response_hash: string | null;
  response_body: string | null;
  response_is_json: boolean | null;
  status_code: number | null;
};

const pool = new Pool();

function stableBodyString(body: unknown): string {
  if (body === undefined) return "";

  const normalize = (value: any): any => {
    if (value === null) return null;
    if (Array.isArray(value)) return value.map((v) => normalize(v));
    if (typeof value === "object") {
      const sorted = Object.keys(value as Record<string, unknown>).sort();
      const acc: Record<string, unknown> = {};
      for (const key of sorted) acc[key] = normalize((value as Record<string, unknown>)[key]);
      return acc;
    }
    return value;
  };

  try {
    return JSON.stringify(normalize(body));
  } catch {
    return String(body);
  }
}

function computeRequestHash(req: Request): string {
  const bodyString = stableBodyString(req.body ?? null);
  const basis = `${req.method}:${req.originalUrl}:${bodyString}`;
  return createHash("sha256").update(basis).digest("hex");
}

function serializeBody(value: any, treatAsJson: boolean): { buffer: Buffer | null; isJson: boolean } {
  if (value === undefined) return { buffer: null, isJson: treatAsJson };
  if (Buffer.isBuffer(value)) return { buffer: value, isJson: treatAsJson };
  if (typeof value === "string") return { buffer: Buffer.from(value), isJson: treatAsJson };

  try {
    const serialized = JSON.stringify(value);
    const inferredJson = treatAsJson || (value !== null && typeof value === "object");
    return { buffer: Buffer.from(serialized), isJson: inferredJson };
  } catch {
    return { buffer: Buffer.from(String(value ?? "")), isJson: false };
  }
}

export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();

    const requestHash = computeRequestHash(req);

    try {
      const insertResult = await pool.query(
        `insert into idempotency_keys (key, request_hash, last_status, created_at, updated_at)
         values ($1, $2, $3, now(), now())
         on conflict (key) do nothing
         returning key`,
        [key, requestHash, "IN_PROGRESS"]
      );

      if (insertResult.rowCount === 0) {
        const existingResult = await pool.query<IdempotencyRecord>(
          `select key, request_hash, last_status, response_hash, response_body, response_is_json, status_code
             from idempotency_keys
            where key = $1`,
          [key]
        );
        const existing = existingResult.rows[0];

        if (existing?.request_hash && existing.request_hash !== requestHash) {
          return res.status(409).json({ error: "IDEMPOTENCY_KEY_CONFLICT" });
        }

        const hasReplayableResponse =
          existing?.last_status === "COMPLETED" || existing?.response_body != null || existing?.status_code != null;

        if (existing && hasReplayableResponse) {
          res.setHeader("Idempotent-Replay", "true");
          const statusCode = existing.status_code ?? 200;
          if (existing.response_is_json && existing.response_body != null) {
            try {
              return res.status(statusCode).json(JSON.parse(existing.response_body));
            } catch {
              return res.status(statusCode).send(existing.response_body);
            }
          }
          if (existing.response_body != null) {
            return res.status(statusCode).send(existing.response_body);
          }
          res.status(statusCode);
          return res.send();
        }

        if (existing) {
          res.setHeader("Idempotent-Replay", "pending");
          return res.status(409).json({ error: "IDEMPOTENT_REQUEST_IN_PROGRESS" });
        }
      }

      let responseBuffer: Buffer | null = null;
      let responseIsJson = false;

      const originalJson = res.json.bind(res);
      res.json = (payload: any) => {
        const { buffer, isJson } = serializeBody(payload, true);
        responseBuffer = buffer;
        responseIsJson = isJson;
        return originalJson(payload);
      };

      const originalSend = res.send.bind(res);
      res.send = (payload: any) => {
        if (responseBuffer === null) {
          const inferredJson =
            (payload !== null && typeof payload === "object" && !Buffer.isBuffer(payload)) ||
            ((res.get("Content-Type") || "").includes("application/json"));
          const { buffer, isJson } = serializeBody(payload, inferredJson);
          responseBuffer = buffer;
          responseIsJson = isJson;
        }
        return originalSend(payload);
      };

      const originalEnd = res.end.bind(res);
      res.end = (chunk?: any, encoding?: any, cb?: any) => {
        if (responseBuffer === null && chunk !== undefined && chunk !== null) {
          const inferredJson = (res.get("Content-Type") || "").includes("application/json");
          const { buffer, isJson } = serializeBody(chunk, inferredJson);
          responseBuffer = buffer;
          responseIsJson = responseIsJson || isJson;
        }
        return originalEnd(chunk, encoding as any, cb as any);
      };

      res.on("finish", () => {
        const statusCode = res.statusCode;
        const lastStatus = statusCode >= 400 ? "FAILED" : "COMPLETED";
        const responseBody = responseBuffer ? responseBuffer.toString("utf8") : "";
        const responseHash = responseBody ? createHash("sha256").update(responseBody).digest("hex") : null;
        void pool.query(
          `update idempotency_keys
              set last_status = $2,
                  response_body = $3,
                  response_hash = $4,
                  response_is_json = $5,
                  status_code = $6,
                  updated_at = now()
            where key = $1`,
          [key, lastStatus, responseBody, responseHash, responseIsJson, statusCode]
        );
      });

      res.on("error", (err) => {
        console.error("idempotency middleware response error", err);
        void pool.query(
          `update idempotency_keys
              set last_status = $2,
                  updated_at = now()
            where key = $1`,
          [key, "FAILED"]
        );
      });

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
