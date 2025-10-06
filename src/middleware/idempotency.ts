import { NextFunction, Request, Response } from "express";
import { Pool } from "pg";

const pool = new Pool();

let schemaPromise: Promise<void> | null = null;

const ensureSchema = () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(
        "alter table if exists idempotency_keys add column if not exists request_payload jsonb"
      );
      await pool.query(
        "alter table if exists idempotency_keys add column if not exists response_payload jsonb"
      );
      await pool.query(
        "alter table if exists idempotency_keys add column if not exists status_code integer"
      );
    })();
  }
  return schemaPromise;
};

const recordResponse = (res: Response, key: string) => {
  const locals = res.locals as Record<string, unknown>;
  if (locals.__idempotencyHooked) {
    return;
  }
  locals.__idempotencyHooked = true;

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  const capture = (payload: unknown) => {
    locals.__idempotencyPayload = payload;
    locals.__idempotencyStatus = res.statusCode;
  };

  res.json = ((body: unknown) => {
    capture(body);
    return originalJson(body);
  }) as typeof res.json;

  res.send = ((body?: unknown) => {
    capture(body);
    return originalSend(body);
  }) as typeof res.send;

  res.once("finish", async () => {
    if (!("__idempotencyPayload" in locals)) {
      return;
    }

    const payload = locals.__idempotencyPayload as unknown;
    const statusCode = (locals.__idempotencyStatus as number | undefined) ?? res.statusCode;
    const storedPayload =
      typeof payload === "string" ? JSON.stringify({ body: payload }) : JSON.stringify(payload ?? null);
    const lastStatus = statusCode >= 400 ? "ERROR" : "DONE";

    try {
      await pool.query(
        "update idempotency_keys set last_status=$2, status_code=$3, response_payload=$4::jsonb where key=$1",
        [key, lastStatus, statusCode, storedPayload]
      );
    } catch (err) {
      console.error("[idempotency] failed to persist response", err);
    }
  });
};

export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("Idempotency-Key");
    if (!key) {
      return next();
    }

    await ensureSchema();

    const requestSnapshot = JSON.stringify({
      method: req.method,
      path: req.originalUrl,
      body: req.body ?? null,
      query: req.query ?? null,
    });

    const client = await pool.connect();
    let created = false;

    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "select request_payload, response_payload, status_code, last_status from idempotency_keys where key=$1 for update",
        [key]
      );

      if (existing.rowCount > 0) {
        const row = existing.rows[0] as {
          request_payload: unknown;
          response_payload: unknown;
          status_code: number | null;
          last_status: string | null;
        };

        const storedRequest = JSON.stringify(row.request_payload ?? null);
        if (storedRequest !== requestSnapshot) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "IDEMPOTENT_PAYLOAD_MISMATCH" });
        }

        if (row.response_payload == null) {
          await client.query("COMMIT");
          return res.status(409).json({ error: "IDEMPOTENT_REPLAY_IN_PROGRESS" });
        }

        await client.query("COMMIT");
        const statusCode = row.status_code ?? 200;
        return res.status(statusCode).json(row.response_payload);
      }

      await client.query(
        "insert into idempotency_keys(key,last_status,request_payload) values($1,$2,$3::jsonb)",
        [key, "IN_PROGRESS", requestSnapshot]
      );
      await client.query("COMMIT");
      created = true;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[idempotency] failed to claim key", err);
      return res.status(500).json({ error: "IDEMPOTENCY_FAILURE" });
    } finally {
      client.release();
    }

    if (created) {
      recordResponse(res, key);
    }

    return next();
  };
}

