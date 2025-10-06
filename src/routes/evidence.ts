import { Request, Response } from "express";
import { buildEvidenceBundle } from "../evidence/bundle";
import { createZipArchive } from "../utils/zip";

function resolveContext(req: Request) {
  const { periodId } = req.params;
  const { abn, taxType } = req.query as { abn?: string; taxType?: string };

  if (!periodId) {
    throw new Error("PERIOD_REQUIRED");
  }

  if (!abn || !taxType) {
    const err = new Error("MISSING_QUERY_PARAMS");
    (err as any).status = 400;
    throw err;
  }

  return { periodId, abn, taxType: taxType as "PAYGW" | "GST" };
}

export async function getEvidenceJson(req: Request, res: Response) {
  try {
    const { periodId, abn, taxType } = resolveContext(req);
    const bundle = await buildEvidenceBundle(abn, taxType, periodId);
    res.type("application/json").send(JSON.stringify(bundle, null, 2));
  } catch (error) {
    const message = (error as Error).message || "UNKNOWN_ERROR";
    const status =
      (error as any).status ??
      (message === "PERIOD_NOT_FOUND" ? 404 : message === "MISSING_CONTEXT" ? 400 : 500);
    res.status(status).json({ error: message });
  }
}

export async function getEvidenceZip(req: Request, res: Response) {
  try {
    const { periodId, abn, taxType } = resolveContext(req);
    const bundle = await buildEvidenceBundle(abn, taxType, periodId);

    const files = [
      { name: "evidence.json", contents: JSON.stringify(bundle, null, 2) },
    ];

    const receipt = bundle.details.receipt;
    if (receipt.id || receipt.provider_ref) {
      const receiptLines = [
        `Receipt ID: ${receipt.id ?? ""}`,
        `Channel: ${receipt.channel ?? ""}`,
        `Provider Reference: ${receipt.provider_ref ?? ""}`,
        `Dry Run: ${receipt.dry_run ? "yes" : "no"}`,
      ];
      files.push({ name: "receipt.txt", contents: receiptLines.join("\n") });
    }

    const archive = createZipArchive(files);
    res
      .status(200)
      .set({
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${periodId}_evidence.zip"`,
        "Content-Length": archive.length,
      })
      .send(archive);
  } catch (error) {
    const message = (error as Error).message || "UNKNOWN_ERROR";
    const status =
      (error as any).status ??
      (message === "PERIOD_NOT_FOUND" ? 404 : message === "MISSING_CONTEXT" ? 400 : 500);
    res.status(status).json({ error: message });
  }
}
