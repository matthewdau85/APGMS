import crypto from "crypto";
import { Router } from "express";
import { Pool } from "pg";
import { ensureSettlementSchema } from "../../settlement/schema";

const pool = new Pool();

export interface SimReleaseParams {
  rail: "eft" | "bpay";
  amount_cents: number;
  abn: string;
  period_id: string;
  idem_key: string;
}

export interface SimReleaseResult {
  provider_ref: string;
  rail: string;
  amount_cents: number;
  abn: string;
  period_id: string;
  paid_at: string;
}

async function ensureSimTable() {
  await ensureSettlementSchema();
  await pool.query(`
    create table if not exists sim_settlements (
      provider_ref text primary key,
      rail text not null,
      amount_cents int not null,
      abn text not null,
      period_id text not null,
      idem_key text unique not null,
      paid_at timestamptz default now()
    )
  `);
}

export async function performSimRelease(params: SimReleaseParams): Promise<SimReleaseResult> {
  const { rail, amount_cents, abn, period_id, idem_key } = params;
  if (!idem_key) {
    throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  }

  await ensureSimTable();

  const existing = await pool.query<SimReleaseResult & { paid_at: Date }>(
    "select provider_ref, rail, amount_cents, abn, period_id, paid_at from sim_settlements where idem_key=$1",
    [idem_key]
  );
  if (existing.rowCount > 0) {
    const row = existing.rows[0];
    return { ...row, paid_at: new Date(row.paid_at).toISOString() };
  }

  const hashInput = `${abn}|${period_id}|${amount_cents}|${rail}|${idem_key}`;
  const provider_ref =
    "SIM-" + crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 18);

  const insert = await pool.query<SimReleaseResult & { paid_at: Date }>(
    "insert into sim_settlements(provider_ref,rail,amount_cents,abn,period_id,idem_key) values($1,$2,$3,$4,$5,$6) returning provider_ref, rail, amount_cents, abn, period_id, paid_at",
    [provider_ref, rail, amount_cents, abn, period_id, idem_key]
  );

  const row = insert.rows[0];
  return { ...row, paid_at: new Date(row.paid_at).toISOString() };
}

export const simRail = (router: Router) => {
  router.post("/sim/rail/release", async (req, res) => {
    try {
      const idem_key = req.header("Idempotency-Key") || req.body?.idem_key;
      const { rail, amount_cents, abn, period_id } = req.body || {};
      if (!rail || !["eft", "bpay"].includes(String(rail).toLowerCase())) {
        return res.status(400).json({ error: "INVALID_RAIL" });
      }
      if (!Number.isFinite(Number(amount_cents))) {
        return res.status(400).json({ error: "INVALID_AMOUNT" });
      }
      if (!abn || !period_id) {
        return res.status(400).json({ error: "INVALID_PERIOD" });
      }

      const result = await performSimRelease({
        rail: String(rail).toLowerCase() as SimReleaseParams["rail"],
        amount_cents: Number(amount_cents),
        abn,
        period_id,
        idem_key: String(idem_key || ""),
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: String(error?.message || error) });
    }
  });
};
