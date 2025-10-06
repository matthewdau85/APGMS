import { Router } from "express";
import { Pool } from "pg";
import { ensureSettlementSchema } from "../settlement/schema";

const pool = new Pool();

function isoOrNull(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export const registerIntegrationsOps = (router: Router) => {
  router.get("/ops/integrations/telemetry", async (_req, res) => {
    try {
      await ensureSettlementSchema();
      const lastReceipt = await pool.query(
        "select max(paid_at) as last from settlements",
        []
      );
      const lastImport = await pool.query(
        "select max(imported_at) as last from recon_imports",
        []
      );
      res.json({
        last_receipt_at: isoOrNull(lastReceipt.rows[0]?.last),
        last_recon_import_at: isoOrNull(lastImport.rows[0]?.last),
      });
    } catch (error: any) {
      res.status(500).json({ error: String(error?.message || error) });
    }
  });
};
