import { Request, Response } from "express";
import { buildEvidenceBundle } from "../evidence/bundle";
import { createZip } from "../utils/zip";
import { EvidenceBundle } from "../types/evidence";

interface EvidenceIdentifiers {
  abn: string;
  taxType: string;
  periodId: string;
}

function parseIdentifiers(req: Request, res: Response): EvidenceIdentifiers | null {
  const { periodId } = req.params as { periodId?: string };
  const abn = String((req.query.abn ?? "").toString()).trim();
  const taxParam = String((req.query.taxType ?? req.query.tax_type ?? "").toString()).trim();

  if (!periodId) {
    res.status(400).json({ error: "PERIOD_ID_REQUIRED" });
    return null;
  }
  if (!abn) {
    res.status(400).json({ error: "ABN_REQUIRED" });
    return null;
  }
  if (!taxParam) {
    res.status(400).json({ error: "TAX_TYPE_REQUIRED" });
    return null;
  }

  return { abn, taxType: taxParam.toUpperCase(), periodId };
}

function evidenceFileBase({ abn, periodId, taxType }: EvidenceIdentifiers) {
  return `evidence_${abn}_${periodId}_${taxType}`;
}

function receiptText(bundle: EvidenceBundle): string {
  if (bundle.receipt?.raw) {
    return bundle.receipt.raw;
  }
  const lines = [
    "APGMS Bank Receipt",
    `Period: ${bundle.period_id}`,
    `Channel: ${bundle.receipt.channel ?? "UNKNOWN"}`,
    `Provider Reference: ${bundle.receipt.provider_ref ?? "N/A"}`,
    `Transfer UUID: ${bundle.receipt.id ?? "N/A"}`,
    `Amount (AUD): ${(bundle.period_summary.totals.final_liability_cents / 100).toFixed(2)}`,
    `Dry Run: ${bundle.receipt.dry_run}`,
  ];
  return lines.join("\n");
}

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "PERIOD_NOT_FOUND" || message === "RPT_NOT_FOUND") {
    return res.status(404).json({ error: message });
  }
  console.error("[evidence]", error);
  return res.status(500).json({ error: "INTERNAL_ERROR" });
}

export async function getEvidenceJson(req: Request, res: Response) {
  const identifiers = parseIdentifiers(req, res);
  if (!identifiers) return;
  try {
    const bundle = await buildEvidenceBundle(identifiers.abn, identifiers.taxType, identifiers.periodId);
    res.setHeader("Cache-Control", "no-store");
    res.type("application/json");
    res.send(JSON.stringify(bundle, null, 2));
  } catch (error) {
    handleError(res, error);
  }
}

export async function getEvidenceZip(req: Request, res: Response) {
  const identifiers = parseIdentifiers(req, res);
  if (!identifiers) return;
  try {
    const bundle = await buildEvidenceBundle(identifiers.abn, identifiers.taxType, identifiers.periodId);
    const base = evidenceFileBase(identifiers);
    const files = [
      { name: `${base}.json`, data: JSON.stringify(bundle, null, 2) },
      { name: `receipt_${bundle.receipt.id ?? "pending"}.txt`, data: receiptText(bundle) },
    ];
    const zipBuffer = createZip(files);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename=\"${base}.zip\"`);
    res.type("application/zip");
    res.send(zipBuffer);
  } catch (error) {
    handleError(res, error);
  }
}
