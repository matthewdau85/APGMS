import crypto from "crypto";
import { Pool } from "pg";
import { Request, Response } from "express";

const pool = new Pool();
const HMAC_HEADER = "x-signature";

function safeCompare(a: string, b: string) {
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function validateHmac(req: Request, rawBody: string) {
  const secret = process.env.RECON_HMAC_SECRET || "";
  if (!secret) throw new Error("RECON_HMAC_SECRET not configured");
  const sent = (req.headers[HMAC_HEADER] as string | undefined)?.toString() || "";
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!sent || sent.length !== expected.length) {
    throw new Error("HMAC_INVALID");
  }
  try {
    if (!safeCompare(sent, expected)) {
      throw new Error("HMAC_INVALID");
    }
  } catch {
    throw new Error("HMAC_INVALID");
  }
}

async function upsertReconInput(source: "STP" | "POS", periodId: string, providerRef: string, payload: any) {
  const stmt = `
    INSERT INTO recon_inputs (source, period_id, provider_ref, payload)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (source, provider_ref)
    DO UPDATE SET payload = EXCLUDED.payload, period_id = EXCLUDED.period_id, updated_at = now()
  `;
  await pool.query(stmt, [source, periodId, providerRef, JSON.stringify(payload)]);
}

async function recomputeGate(periodId: string) {
  const { rows } = await pool.query(
    "select source, payload from recon_inputs where period_id=$1",
    [periodId]
  );
  const sources = new Set(rows.map((r: any) => r.source));
  if (sources.has("STP") && sources.has("POS")) {
    await pool.query(
      "insert into gate_transitions(period_id, gate, state, reason, updated_at) values ($1,$2,$3,$4, now())",
      [periodId, "RECON", "RECON_OK", "STP and POS matched"]
    );
    return { state: "RECON_OK", reason: "STP and POS matched" };
  }
  const reason = sources.size === 0 ? "NO_RECON_INPUT" : "MISSING_COUNTERPART";
  await pool.query(
    "insert into gate_transitions(period_id, gate, state, reason, updated_at) values ($1,$2,$3,$4, now())",
    [periodId, "RECON", "RECON_FAIL", reason]
  );
  return { state: "RECON_FAIL", reason };
}

export async function ingestStp(req: Request, res: Response) {
  const raw = JSON.stringify(req.body || {});
  try {
    validateHmac(req, raw);
  } catch (err: any) {
    return res.status(401).json({ error: err.message });
  }
  const { period_id, provider_ref } = req.body || {};
  if (!period_id || !provider_ref) {
    return res.status(400).json({ error: "period_id/provider_ref required" });
  }
  await upsertReconInput("STP", period_id, provider_ref, req.body);
  const result = await recomputeGate(period_id);
  res.json({ ok: true, gate: result });
}

export async function ingestPos(req: Request, res: Response) {
  const raw = JSON.stringify(req.body || {});
  try {
    validateHmac(req, raw);
  } catch (err: any) {
    return res.status(401).json({ error: err.message });
  }
  const { period_id, provider_ref } = req.body || {};
  if (!period_id || !provider_ref) {
    return res.status(400).json({ error: "period_id/provider_ref required" });
  }
  await upsertReconInput("POS", period_id, provider_ref, req.body);
  const result = await recomputeGate(period_id);
  res.json({ ok: true, gate: result });
}

export async function gateTransition(req: Request, res: Response) {
  const { periodId } = req.query as any;
  if (!periodId) {
    return res.status(400).json({ error: "periodId required" });
  }
  const { rows } = await pool.query(
    "select gate, state, reason, updated_at from gate_transitions where period_id=$1 order by updated_at desc limit 1",
    [periodId]
  );
  if (!rows.length) {
    return res.status(404).json({ error: "NO_TRANSITIONS" });
  }
  res.json(rows[0]);
}
