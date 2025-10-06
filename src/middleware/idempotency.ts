import { NextFunction, Request, Response } from "express";
import { PoolClient } from "pg";
import { getPool } from "../db/pool";
import { buildErrorBody } from "../utils/responses";

export type IdempotencyStatus = "IN_PROGRESS" | "DONE" | "FAILED";

async function insertKey(key: string) {
  const pool = getPool();
  await pool.query("insert into idempotency_keys(key,last_status) values ($1,$2)", [key, "IN_PROGRESS"]);
}

async function fetchKey(key: string) {
  const pool = getPool();
  const { rows } = await pool.query("select last_status, response_json from idempotency_keys where key=$1", [key]);
  return rows[0];
}

export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();
    try {
      await insertKey(key);
      (res.locals as any).idempotencyKey = key;
      return next();
    } catch {
      const record = await fetchKey(key);
      if (record?.response_json) {
        res.setHeader("x-idempotent", "true");
        return res.status(200).json(record.response_json);
      }
      const body = buildErrorBody(res, 409, {
        title: "Idempotent replay in progress",
        detail: "Another request with this Idempotency-Key is still processing.",
        code: "IDEMPOTENT_REPLAY",
      });
      return res.status(409).json(body);
    }
  };
}

export async function saveIdempotencyResult(
  client: PoolClient | null,
  key: string | undefined,
  status: IdempotencyStatus,
  body: any
) {
  if (!key) return;
  const runner = client ?? getPool();
  await runner.query(
    "update idempotency_keys set last_status=$1, response_json=$2 where key=$3",
    [status, body, key]
  );
}
