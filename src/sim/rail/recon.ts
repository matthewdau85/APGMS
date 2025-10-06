import { Router } from "express";
import { Pool } from "pg";
import { ensureSettlementSchema } from "../../settlement/schema";

const pool = new Pool();

export interface ReconRow {
  provider_ref: string;
  rail: string;
  amount_cents: number;
  paid_at: string;
  abn: string;
  period_id: string;
}

function toCsv(rows: ReconRow[]): string {
  const header = "provider_ref,rail,amount_cents,paid_at,abn,period_id";
  const lines = rows.map((r) =>
    [r.provider_ref, r.rail, r.amount_cents, r.paid_at, r.abn, r.period_id]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header, ...lines].join("\n");
}

export async function fetchReconRows(since?: string): Promise<ReconRow[]> {
  await ensureSettlementSchema();
  const params: any[] = [];
  let where = "";
  if (since) {
    where = " where paid_at >= $1";
    params.push(new Date(since));
  }
  const { rows } = await pool.query<ReconRow & { paid_at: Date }>(
    `select provider_ref, rail, amount_cents, paid_at, abn, period_id
     from sim_settlements${where}
     order by paid_at asc`,
    params
  );
  return rows.map((row) => ({
    ...row,
    paid_at: new Date(row.paid_at).toISOString(),
  }));
}

export const simRecon = (router: Router) => {
  router.get("/sim/rail/recon-file", async (req, res) => {
    try {
      const { since } = req.query as { since?: string };
      const rows = await fetchReconRows(since);
      res.type("text/csv").send(toCsv(rows));
    } catch (error: any) {
      res.status(500).json({ error: String(error?.message || error) });
    }
  });
};
