import type { Request, Response } from "express";
import { applyRecon, parseReconInput } from "../recon/importer.js";

export async function settlementImport(req: Request, res: Response) {
  const rows = parseReconInput(req.body ?? {});
  if (!rows.length) {
    return res.status(400).json({
      code: "NO_ROWS",
      title: "No settlements",
      detail: "No settlement rows were provided",
    });
  }
  const summary = applyRecon(rows);
  res.json(summary);
}
