import express from "express";
import { Pool } from "pg";

const pool = new Pool();

export const opsIntegrationsRouter = express.Router();

opsIntegrationsRouter.get("/telemetry", async (_req, res) => {
  try {
    const receipts = await pool.query<{ last_receipt_at: Date | null }>(
      "select max(paid_at) as last_receipt_at from settlements",
    );
    const imports = await pool.query<{ last_recon_import_at: Date | null }>(
      "select max(imported_at) as last_recon_import_at from settlement_imports",
    );
    const last_receipt_at = receipts.rows[0]?.last_receipt_at
      ? new Date(receipts.rows[0].last_receipt_at).toISOString()
      : null;
    const last_recon_import_at = imports.rows[0]?.last_recon_import_at
      ? new Date(imports.rows[0].last_recon_import_at).toISOString()
      : null;
    return res.json({ last_receipt_at, last_recon_import_at });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Telemetry unavailable" });
  }
});
