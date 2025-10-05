import { Pool } from "pg";

import { sha256Hex } from "../crypto/merkle";

const pool = new Pool();

/** Express middleware for idempotency via Idempotency-Key header */
export function idempotency() {
  return async (req: any, res: any, next: any) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();

    let claimed = false;
    try {
      const existing = await pool.query(
        "select last_status, response_hash, status_code, response_body from idempotency_keys where key=$1",
        [key]
      );
      const row = existing.rows[0];
      if (row) {
        if (row.status_code != null) {
          res.setHeader("X-Idempotent-Replay", "true");
          return res.status(row.status_code).send(row.response_body ?? null);
        }
        // Another request is still computing the response
        return res.status(409).json({ idempotent: true, status: row.last_status ?? "IN_PROGRESS" });
      }

      const inserted = await pool.query(
        "insert into idempotency_keys(key,last_status,status_code,response_hash,response_body) values($1,$2,$3,$4,$5) on conflict do nothing",
        [key, "INIT", null, null, null]
      );
      if (inserted.rowCount === 0) {
        const retry = await pool.query(
          "select last_status, response_hash, status_code, response_body from idempotency_keys where key=$1",
          [key]
        );
        const retryRow = retry.rows[0];
        if (retryRow && retryRow.status_code != null) {
          res.setHeader("X-Idempotent-Replay", "true");
          return res.status(retryRow.status_code).send(retryRow.response_body ?? null);
        }
        return res.status(409).json({ idempotent: true, status: retryRow?.last_status ?? "IN_PROGRESS" });
      }
      claimed = true;
    } catch (err) {
      console.error("idempotency middleware failed", err);
      return next();
    }

    let capturedBody: any = undefined;
    const capture = (body: any) => {
      capturedBody = body;
    };

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      capture(body);
      return originalJson(body);
    };

    const originalSend = res.send.bind(res);
    res.send = (body: any) => {
      capture(body);
      return originalSend(body);
    };

    res.on("finish", () => {
      if (!claimed) return;
      let bodyToStore = capturedBody;
      if (bodyToStore === undefined) {
        bodyToStore = null;
      }

      let hashInput: string;
      if (Buffer.isBuffer(bodyToStore)) {
        hashInput = bodyToStore.toString("utf8");
        bodyToStore = hashInput;
      } else if (typeof bodyToStore === "string") {
        hashInput = bodyToStore;
      } else {
        try {
          hashInput = JSON.stringify(bodyToStore);
        } catch {
          hashInput = String(bodyToStore);
        }
      }

      const statusCode = res.statusCode || 200;
      const lastStatus = statusCode >= 400 ? "ERROR" : "DONE";
      const responseHash = sha256Hex(hashInput ?? "");

      pool
        .query(
          "update idempotency_keys set last_status=$2, status_code=$3, response_hash=$4, response_body=$5 where key=$1",
          [key, lastStatus, statusCode, responseHash, bodyToStore]
        )
        .catch((err: unknown) => {
          console.error("failed to persist idempotent response", err);
        });
    });

    return next();
  };
}
