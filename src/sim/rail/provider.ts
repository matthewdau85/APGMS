import express from "express";
import { Pool } from "pg";
import { createHash } from "crypto";

const pool = new Pool();

type DbClient = Pick<Pool, "query">;

export interface SimReleaseRequest {
  rail: "eft" | "bpay";
  amount_cents: number;
  abn: string;
  period_id: string;
  idemKey: string;
}

export interface SimReleaseResponse {
  provider_ref: string;
  paid_at: string;
}

function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function asIso(value: any): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

async function persistSettlement(db: DbClient, req: SimReleaseRequest, provider_ref: string, paid_at: string) {
  await db.query(
    `insert into sim_settlements(provider_ref, rail, amount_cents, abn, period_id, idem_key, paid_at)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (provider_ref) do update
       set rail=excluded.rail,
           amount_cents=excluded.amount_cents,
           abn=excluded.abn,
           period_id=excluded.period_id,
           idem_key=excluded.idem_key,
           paid_at=excluded.paid_at`,
    [
      provider_ref,
      req.rail.toUpperCase(),
      req.amount_cents,
      req.abn,
      req.period_id,
      req.idemKey,
      paid_at,
    ],
  );
}

export async function releaseSimPayment(request: SimReleaseRequest, db: DbClient = pool): Promise<SimReleaseResponse> {
  if (!request.idemKey) {
    throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  }

  const { rows } = await db.query(
    `select provider_ref, paid_at from sim_settlements where idem_key=$1 limit 1`,
    [request.idemKey],
  );
  if (rows.length > 0) {
    const existing = rows[0];
    return { provider_ref: existing.provider_ref, paid_at: asIso(existing.paid_at) };
  }

  const basis = [request.abn, request.period_id, request.amount_cents, request.rail, request.idemKey].join("|");
  const provider_ref = `SIM-${stableHash(basis)}`;
  const paid_at = new Date().toISOString();

  await persistSettlement(db, request, provider_ref, paid_at);

  return { provider_ref, paid_at };
}

export const simRailRouter = express.Router();

simRailRouter.post("/release", async (req, res) => {
  try {
    const idemKey = req.get("Idempotency-Key") || "";
    const { rail, amount_cents, abn, period_id } = req.body || {};
    if (!rail || !abn || !period_id || typeof amount_cents !== "number") {
      return res.status(400).json({ error: "Missing rail/amount_cents/abn/period_id" });
    }
    const normalizedRail = String(rail).toLowerCase();
    if (normalizedRail !== "eft" && normalizedRail !== "bpay") {
      return res.status(400).json({ error: "Invalid rail" });
    }
    const response = await releaseSimPayment({
      rail: normalizedRail as "eft" | "bpay",
      amount_cents: amount_cents,
      abn,
      period_id,
      idemKey,
    });
    return res.json(response);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Sim release failed" });
  }
});
