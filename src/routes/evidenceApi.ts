import { Router } from "express";
import { buildEvidenceBundle } from "../evidence/bundle";
import { getSettlement } from "../ingest/store";
import { createZip } from "../utils/zip";

const router = Router();

router.get("/:periodId", async (req, res) => {
  const { periodId } = req.params;
  const bundle = await buildEvidenceBundle(periodId);
  res.json(bundle);
});

router.get("/:periodId.zip", async (req, res) => {
  const { periodId } = req.params;
  const bundle = await buildEvidenceBundle(periodId);
  const settlement = getSettlement(periodId);
  const entries = [
    { name: "evidence.json", content: Buffer.from(JSON.stringify(bundle, null, 2), "utf8") },
  ];
  if (settlement?.receiptPayload) {
    entries.push({ name: "settlement-receipt.json", content: Buffer.from(JSON.stringify(settlement.receiptPayload, null, 2), "utf8") });
  }
  const archive = createZip(entries);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename=${periodId}.zip`);
  res.send(archive);
});

export const evidenceRouter = router;
