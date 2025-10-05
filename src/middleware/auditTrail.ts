import crypto from "crypto";
import type { RequestHandler } from "express";
import { Pool } from "pg";

interface AuditEvent {
  actorSub: string;
  method: string;
  targetUrl: string;
  status: number;
  timestamp: string;
}

const pool = new Pool();

export function auditTrail(): RequestHandler {
  return (req, res, next) => {
    res.on("finish", () => {
      if (req.method === "OPTIONS") return;
      const event: AuditEvent = {
        actorSub: req.auth?.sub ?? "anonymous",
        method: req.method,
        targetUrl: req.originalUrl,
        status: res.statusCode,
        timestamp: new Date().toISOString(),
      };
      void persistAuditEvent(event).catch((err) => {
        console.error("audit trail failure", err);
      });
    });
    next();
  };
}

async function persistAuditEvent(event: AuditEvent): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      event_hash: string;
    }>("SELECT event_hash FROM audit_events ORDER BY id DESC LIMIT 1 FOR UPDATE");
    const prevHash = rows[0]?.event_hash ?? null;
    const payload = { ...event };
    const payloadString = JSON.stringify(payload);
    const eventHash = crypto.createHash("sha256").update((prevHash ?? "") + payloadString).digest("hex");
    await client.query(
      `INSERT INTO audit_events(actor_sub, action, target_url, response_status, event_payload, prev_hash, event_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [event.actorSub, event.method, event.targetUrl, event.status, payload, prevHash, eventHash]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
