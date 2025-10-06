// apps/services/payments/src/middleware/rptGate.ts
import { Request, Response, NextFunction } from "express";
import pg from "pg";
import nacl from "tweetnacl";
import { sha256Hex } from "../utils/crypto";

const { Pool } = pg;

const DEFAULT_SECRET = "zt4Y+4kcx4Axd6e/a8NuXD0lVn8JIWQwHwJM0vlA2+vi6UIwf0gnqgKr+LKkGAqRTSCz8xms8DJNonp125yhJQ==";
const DEFAULT_PUBLIC = "4ulCMH9IJ6oCq/iypBgKkU0gs/MZrPAyTaJ6dducoSU=";

const connectionString =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || "apgms"}:${encodeURIComponent(process.env.PGPASSWORD || "")}` +
  `@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "apgms"}`;

const pool = new Pool({ connectionString });

function getPublicKey(): Uint8Array {
  const pub = process.env.RPT_ED25519_PUBLIC_BASE64 || DEFAULT_PUBLIC;
  if (pub) return new Uint8Array(Buffer.from(pub, "base64"));
  const priv = process.env.RPT_ED25519_SECRET_BASE64 || DEFAULT_SECRET;
  if (!priv) throw new Error("Missing RPT ed25519 key material");
  const buf = Buffer.from(priv, "base64");
  if (buf.length === 64) {
    return buf.subarray(32);
  }
  if (buf.length === 32) {
    return buf;
  }
  throw new Error("Invalid ed25519 key length");
}

const publicKey = getPublicKey();

export async function rptGate(req: Request, res: Response, next: NextFunction) {
  try {
    const { abn, taxType, periodId } = req.body || {};
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    const q = `
      SELECT id as rpt_id, payload_c14n, payload_sha256, signature, expires_at, status, nonce, payload
      FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND status <> 'released'
      ORDER BY id DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [abn, taxType, periodId]);
    if (!rows.length) return res.status(403).json({ error: "No RPT for period" });

    const row = rows[0];
    if (row.expires_at && new Date() > new Date(row.expires_at)) {
      return res.status(403).json({ error: "RPT expired" });
    }

    const payloadStr: string = row.payload_c14n ?? JSON.stringify(row.payload ?? {});
    const sha = sha256Hex(payloadStr);
    if (row.payload_sha256 && row.payload_sha256 !== sha) {
      return res.status(403).json({ error: "Payload hash mismatch" });
    }

    const payload = JSON.parse(payloadStr);
    if (String(payload.abn) !== String(abn) || String(payload.period_id) !== String(periodId) || String(payload.tax_type) !== String(taxType)) {
      return res.status(403).json({ error: "RPT payload mismatch" });
    }

    const sigBuf = Buffer.from(row.signature, "base64url");
    const msg = new TextEncoder().encode(payloadStr);
    if (!nacl.sign.detached.verify(msg, sigBuf, publicKey)) {
      return res.status(403).json({ error: "RPT signature invalid" });
    }

    const period = await pool.query<{ rates_version: string }>(
      "SELECT rates_version FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    );
    const expectedRates = period.rows[0]?.rates_version;
    if (!expectedRates || expectedRates !== payload.rates_version) {
      return res.status(409).json({ error: "RATES_VERSION_MISMATCH", expected: expectedRates, got: payload.rates_version });
    }

    (req as any).rpt = { rpt_id: row.rpt_id, payload, payload_sha256: sha };
    next();
  } catch (e: any) {
    return res.status(500).json({ error: "RPT verification error", detail: String(e?.message || e) });
  }
}
