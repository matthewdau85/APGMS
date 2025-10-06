import { Request, Response } from "express";
import { Pool } from "pg";
import { appendAudit } from "../audit/appendOnly";
import { hashIdentifier, logAuditEvent, logSecurityEvent } from "../security/logger";

const pool = new Pool();

export async function upsertAllowlist(req: Request, res: Response) {
  const { abn, label, rail, reference, accountBsb, accountNumber } = req.body ?? {};

  if (!abn || !label || !rail || !reference) {
    logSecurityEvent(req, "allowlist_invalid_payload", { reason: "missing_fields" });
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }

  const normalizedRail = String(rail).toUpperCase();
  if (!["EFT", "BPAY"].includes(normalizedRail)) {
    logSecurityEvent(req, "allowlist_invalid_payload", { reason: "invalid_rail", rail: normalizedRail });
    return res.status(400).json({ error: "INVALID_RAIL" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upsert = `
      INSERT INTO remittance_destinations (abn, label, rail, reference, account_bsb, account_number)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (abn, rail, reference)
      DO UPDATE SET label = EXCLUDED.label,
                    account_bsb = EXCLUDED.account_bsb,
                    account_number = EXCLUDED.account_number
      RETURNING id, abn, label, rail, reference, account_bsb, account_number
    `;
    const { rows } = await client.query(upsert, [
      String(abn),
      String(label),
      normalizedRail,
      String(reference),
      accountBsb ? String(accountBsb) : null,
      accountNumber ? String(accountNumber) : null,
    ]);

    await client.query("COMMIT");

    const actor = req.user?.sub ? `user:${hashIdentifier(req.user.sub)}` : "user:anonymous";
    await appendAudit(actor, "allowlist_upsert", {
      abn: String(abn),
      rail: normalizedRail,
      reference: String(reference),
      requestId: req.requestId,
    });
    logAuditEvent(req, "allowlist_upsert", { rail: normalizedRail, reference: String(reference) });

    return res.json({ ok: true, destination: rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    const detail = error instanceof Error ? error.message : String(error);
    logSecurityEvent(req, "allowlist_upsert_failed", { detail });
    return res.status(500).json({ error: "ALLOWLIST_UPDATE_FAILED" });
  } finally {
    client.release();
  }
}
