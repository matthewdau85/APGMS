// apps/services/payments/src/middleware/rptGate.ts
import { Request, Response, NextFunction } from "express";
import pg from "pg"; const { Pool } = pg;
import { sha256Hex } from "../utils/crypto";
import { selectKms } from "../kms/kmsProvider";

const kms = selectKms();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const HEADER_TOKEN = "x-rpt-token";
const HEADER_HEAD = "x-rpt-head";

function header(req: Request, name: string): string | undefined {
  return req.header(name) ?? req.header(name.toUpperCase());
}

export async function rptGate(req: Request, res: Response, next: NextFunction) {
  try {
    const { abn, taxType, periodId } = req.body || {};
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    const tokenHeader = header(req, HEADER_TOKEN) ?? (req.body?.rptToken as string | undefined);
    const headHeader = header(req, HEADER_HEAD) ?? (req.body?.rptHead as string | undefined);
    if (!tokenHeader || !headHeader) {
      return res.status(403).json({ error: "RPT headers missing", required: [HEADER_TOKEN, HEADER_HEAD] });
    }

    // Accept pending/active. Order by created_at so newest wins.
    const q = `
      SELECT id as rpt_id, kid, payload, payload_c14n, payload_sha256, signature, expires_at, status, nonce
      FROM rpt_tokens
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3
        AND status IN ('pending','active')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [abn, taxType, periodId]);
    if (!rows.length) return res.status(403).json({ error: "No active RPT for period" });

    const r = rows[0];
    if (r.expires_at && new Date() > new Date(r.expires_at)) {
      return res.status(403).json({ error: "RPT expired" });
    }

    const payloadStr = r.payload_c14n ?? JSON.stringify(r.payload);
    if (!payloadStr) {
      return res.status(500).json({ error: "RPT payload missing" });
    }

    // Hash check
    const recomputed = sha256Hex(payloadStr);
    if (recomputed !== r.payload_sha256) {
      return res.status(403).json({ error: "Payload hash mismatch" });
    }

    if (headHeader !== r.payload_sha256) {
      return res.status(403).json({ error: "RPT head mismatch" });
    }

    if (tokenHeader !== r.signature) {
      return res.status(403).json({ error: "RPT token mismatch" });
    }

    // Signature verify (signature is stored as base64 text in your seed)
    const payload = Buffer.from(payloadStr);
    let sig: Buffer;
    try {
      sig = Buffer.from(tokenHeader, "base64");
    } catch {
      return res.status(403).json({ error: "RPT token not base64" });
    }

    const ok = await kms.verify(payload, sig, r.kid ?? undefined);
    if (!ok) return res.status(403).json({ error: "RPT signature invalid" });

    (req as any).rpt = {
      rpt_id: r.rpt_id,
      kid: r.kid ?? null,
      nonce: r.nonce,
      payload_sha256: r.payload_sha256,
    };
    return next();
  } catch (e: any) {
    return res.status(500).json({ error: "RPT verification error", detail: String(e?.message || e) });
  }
}
