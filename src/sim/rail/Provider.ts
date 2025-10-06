import { Router } from "express";
import { Pool } from "pg";
import { randomUUID } from "crypto";

export type SimSettlementRow = {
  provider_ref: string;
  amount_cents: number;
  paid_at: string;
  rail: "EFT" | "BPAY";
  idem_key: string | null;
  abn?: string;
  tax_type?: string;
  period_id?: string;
  reference?: string;
};

const pool = new Pool();

let ensured = false;
async function ensureSimTable() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sim_settlements (
      id           BIGSERIAL PRIMARY KEY,
      provider_ref TEXT NOT NULL UNIQUE,
      amount_cents BIGINT NOT NULL,
      paid_at      TIMESTAMPTZ NOT NULL,
      rail         TEXT NOT NULL,
      idem_key     TEXT,
      abn          TEXT,
      tax_type     TEXT,
      period_id    TEXT,
      reference    TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_sim_settlements_idem_key
      ON sim_settlements(idem_key, rail)
      WHERE idem_key IS NOT NULL;
  `);
  ensured = true;
}

function normaliseRail(railParam: string): "EFT" | "BPAY" {
  const upper = railParam.toUpperCase();
  if (upper !== "EFT" && upper !== "BPAY") {
    throw new Error("Unsupported rail");
  }
  return upper;
}

export async function recordSimSettlement(row: Omit<SimSettlementRow, "paid_at"> & { paid_at: Date }) {
  await ensureSimTable();
  await pool.query(
    `INSERT INTO sim_settlements
       (provider_ref, amount_cents, paid_at, rail, idem_key, abn, tax_type, period_id, reference)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (provider_ref) DO UPDATE SET
       amount_cents = EXCLUDED.amount_cents,
       paid_at = EXCLUDED.paid_at,
       rail = EXCLUDED.rail,
       idem_key = EXCLUDED.idem_key,
       abn = EXCLUDED.abn,
       tax_type = EXCLUDED.tax_type,
       period_id = EXCLUDED.period_id,
       reference = EXCLUDED.reference,
       updated_at = NOW()
    `,
    [
      row.provider_ref,
      row.amount_cents,
      row.paid_at,
      row.rail,
      row.idem_key,
      row.abn ?? null,
      row.tax_type ?? null,
      row.period_id ?? null,
      row.reference ?? null,
    ]
  );
}

export const simRailRouter = Router();

simRailRouter.post("/:rail(eft|bpay)", async (req, res) => {
  try {
    const rail = normaliseRail(req.params.rail);
    const idemKey = req.header("Idempotency-Key") || null;
    const amount = Number(req.body?.amount_cents ?? req.body?.amountCents);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount_cents must be > 0" });
    }
    await ensureSimTable();

    if (idemKey) {
      const existing = await pool.query(
        `SELECT provider_ref, paid_at FROM sim_settlements WHERE idem_key=$1 AND rail=$2 LIMIT 1`,
        [idemKey, rail]
      );
      if (existing.rowCount) {
        const row = existing.rows[0];
        return res.json({
          provider_ref: row.provider_ref,
          paid_at: new Date(row.paid_at).toISOString(),
        });
      }
    }

    const paidAt = new Date();
    const providerRef = `SIM-${randomUUID()}`;

    try {
      await recordSimSettlement({
        provider_ref: providerRef,
        amount_cents: amount,
        paid_at: paidAt,
        rail,
        idem_key: idemKey,
        abn: req.body?.abn,
        tax_type: req.body?.taxType,
        period_id: req.body?.periodId,
        reference: req.body?.reference,
      });
    } catch (err: any) {
      // handle race on idempotency key
      if (err?.code === "23505" && idemKey) {
        const existing = await pool.query(
          `SELECT provider_ref, paid_at FROM sim_settlements WHERE idem_key=$1 AND rail=$2 LIMIT 1`,
          [idemKey, rail]
        );
        if (existing.rowCount) {
          const row = existing.rows[0];
          return res.json({
            provider_ref: row.provider_ref,
            paid_at: new Date(row.paid_at).toISOString(),
          });
        }
      }
      throw err;
    }

    return res.json({ provider_ref: providerRef, paid_at: paidAt.toISOString() });
  } catch (e: any) {
    return res.status(400).json({ error: String(e?.message || e) });
  }
});

export async function listSimSettlements(since?: Date) {
  await ensureSimTable();
  const params: any[] = [];
  const where = since ? (params.push(since), "WHERE paid_at >= $1") : "";
  const { rows } = await pool.query(
    `SELECT provider_ref, amount_cents, paid_at, rail, idem_key, abn, tax_type, period_id, reference
     FROM sim_settlements
     ${where}
     ORDER BY paid_at ASC, id ASC`
  , params);
  return rows.map((row) => ({
    provider_ref: row.provider_ref,
    amount_cents: Number(row.amount_cents),
    paid_at: new Date(row.paid_at).toISOString(),
    rail: row.rail as "EFT" | "BPAY",
    idem_key: row.idem_key as string | null,
    abn: row.abn ?? undefined,
    tax_type: row.tax_type ?? undefined,
    period_id: row.period_id ?? undefined,
    reference: row.reference ?? undefined,
  }));
}

export { ensureSimTable };
