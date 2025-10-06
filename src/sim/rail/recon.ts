import express from "express";
import { Pool } from "pg";

const pool = new Pool();

function toIso(value: any): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function toCsv(rows: Array<Record<string, any>>): string {
  if (!rows.length) {
    return "provider_ref,rail,amount_cents,paid_at,abn,period_id\n";
  }
  const header = Object.keys(rows[0]);
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((key) => {
      const value = row[key];
      if (value == null) return "";
      if (value instanceof Date) {
        return value.toISOString();
      }
      return String(value);
    }).join(","));
  }
  return lines.join("\n");
}

export const simRailReconRouter = express.Router();

simRailReconRouter.get("/recon-file", async (req, res) => {
  try {
    const sinceParam = req.query.since ? String(req.query.since) : null;
    const since = sinceParam ? new Date(sinceParam) : new Date(0);
    if (Number.isNaN(since.getTime())) {
      return res.status(400).json({ error: "Invalid since parameter" });
    }
    const { rows } = await pool.query(
      `select provider_ref, rail, amount_cents, paid_at, abn, period_id
       from sim_settlements
       where paid_at >= $1
       order by paid_at asc`,
      [since],
    );
    const normalised = rows.map((row) => ({
      provider_ref: row.provider_ref,
      rail: row.rail,
      amount_cents: Number(row.amount_cents),
      paid_at: toIso(row.paid_at),
      abn: row.abn,
      period_id: row.period_id,
    }));
    const csv = toCsv(normalised);
    res.setHeader("content-type", "text/csv");
    return res.send(csv);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to build recon file" });
  }
});
