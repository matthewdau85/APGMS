import { Router } from "express";
import { listSimSettlements } from "./Provider";

function wantsCsv(req: any): boolean {
  const format = (req.query.format || "").toString().toLowerCase();
  if (format === "csv") return true;
  const accept = String(req.headers["accept"] || "");
  return accept.includes("text/csv");
}

function toCsv(rows: Awaited<ReturnType<typeof listSimSettlements>>) {
  const header = "provider_ref,amount_cents,paid_at,rail";
  const body = rows
    .map((r) =>
      [r.provider_ref, r.amount_cents, r.paid_at, r.rail]
        .map((val) => `"${String(val).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
  return `${header}\n${body}`;
}

export const simReconRouter = Router();

simReconRouter.get("/recon-file", async (req, res) => {
  try {
    const sinceParam = req.query.since ? new Date(String(req.query.since)) : undefined;
    if (sinceParam && Number.isNaN(sinceParam.getTime())) {
      return res.status(400).json({ error: "Invalid since timestamp" });
    }
    const rows = await listSimSettlements(sinceParam);
    if (wantsCsv(req)) {
      res.type("text/csv");
      return res.send(toCsv(rows));
    }
    return res.json({ settlements: rows });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});
