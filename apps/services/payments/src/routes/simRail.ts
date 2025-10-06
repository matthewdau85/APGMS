import type { Request, Response } from "express";
import { pool } from "../index.js";

export async function simRailReconFile(req: Request, res: Response) {
  const sinceRaw = req.query.since ? String(req.query.since) : null;
  let sinceDate: Date | null = null;
  if (sinceRaw) {
    const parsed = new Date(sinceRaw);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: "Invalid since parameter" });
    }
    sinceDate = parsed;
  }

  const format = String(req.query.format || "csv").toLowerCase();

  const { rows } = await pool.query(
    `SELECT provider_ref, amount_cents, paid_at FROM sim_settlements
      WHERE paid_at >= COALESCE($1::timestamptz, '1970-01-01'::timestamptz)
      ORDER BY paid_at ASC`,
    [sinceDate ? sinceDate.toISOString() : null],
  );

  if (format === "json") {
    return res.json({ settlements: rows.map(r => ({
      provider_ref: r.provider_ref,
      amount_cents: Number(r.amount_cents),
      paid_at: new Date(r.paid_at).toISOString(),
    })) });
  }

  const header = "provider_ref,amount_cents,paid_at";
  const lines = rows.map(r => `${r.provider_ref},${Number(r.amount_cents)},${new Date(r.paid_at).toISOString()}`);
  const csv = [header, ...lines].join("\n");
  res.type("text/csv").send(csv);
}

