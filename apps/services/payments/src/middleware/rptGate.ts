// apps/services/payments/src/middleware/rptGate.ts
import { Request, Response, NextFunction } from "express";
import pg from "pg"; const { Pool } = pg;
import { sha256Hex } from "../utils/crypto";
import { canonicalizeRptToken } from "../../../../src/crypto/rptSigner";
import { SignedRptEnvelope, verifySignedRpt } from "../../../../src/crypto/rptVerifier";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function extractSignature(raw: any): string | null {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) {
    return Buffer.from(raw).toString("base64url");
  }
  if (typeof raw === "string") {
    try {
      const encoding = raw.includes("-") || raw.includes("_") ? "base64url" : "base64";
      const buf = Buffer.from(raw, encoding as BufferEncoding);
      return Buffer.from(buf).toString("base64url");
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeHash(raw: any): string | null {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw.toString("hex");
  if (typeof raw === "string") return raw.toLowerCase();
  return null;
}

export async function rptGate(req: Request, res: Response, next: NextFunction) {
  try {
    const { abn, taxType, periodId } = req.body || {};
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    const q = `
      SELECT id as rpt_id, payload_json, payload_c14n, payload_sha256, sig_ed25519,
             key_id, nonce, expires_at, status
      FROM rpt_tokens
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3
        AND status IN ('pending','active')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [abn, taxType, periodId]);
    if (!rows.length) return res.status(403).json({ error: "No active RPT for period" });

    const r = rows[0];
    const token: SignedRptEnvelope["token"] | null = r.payload_json ?? r.payload ?? null;
    if (!token || !token.payload) {
      return res.status(403).json({ error: "RPT payload missing" });
    }

    const canonicalStored = typeof r.payload_c14n === "string" ? r.payload_c14n : r.payload_c14n?.toString?.();
    const canonical = canonicalStored ?? canonicalizeRptToken(token);
    const recomputed = sha256Hex(canonical);
    const storedHash = normalizeHash(r.payload_sha256);
    if (storedHash && storedHash !== recomputed) {
      return res.status(403).json({ error: "Payload hash mismatch" });
    }

    const signature = extractSignature(r.sig_ed25519 ?? r.signature);
    if (!signature) {
      return res.status(403).json({ error: "RPT signature missing" });
    }

    const verification = await verifySignedRpt({ token, signature });
    if (!verification.valid) {
      const reason = verification.reason;
      let message = "RPT verification failed";
      if (reason === "UNKNOWN_KID") message = "RPT key unknown";
      else if (reason === "EXPIRED") message = "RPT expired";
      else if (reason === "GRACE_EXCEEDED") message = "RPT signed with retired key";
      else if (reason === "INVALID_SIGNATURE") message = "RPT signature invalid";
      else if (reason === "MALFORMED") message = "RPT malformed";
      return res.status(403).json({ error: message, reason });
    }

    (req as any).rpt = {
      rpt_id: r.rpt_id,
      kid: token.kid,
      issuedAt: token.issuedAt,
      exp: token.exp,
      nonce: r.nonce,
      payload_sha256: recomputed,
    };
    return next();
  } catch (e: any) {
    return res.status(500).json({ error: "RPT verification error", detail: String(e?.message || e) });
  }
}
