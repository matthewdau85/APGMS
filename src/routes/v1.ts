import { Router } from "express";
import { deposit } from "./deposit";
import { closeAndIssue } from "./reconcile";
import { buildEvidenceBundle } from "../evidence/bundle";

export const v1Router = Router();

v1Router.post("/deposit", deposit);
v1Router.post("/reconcile/close-and-issue", closeAndIssue);

v1Router.get("/evidence/:abn/:pid", async (req, res) => {
  try {
    const { abn, pid } = req.params as { abn: string; pid: string };
    const [taxTypePart, ...rest] = pid.split("-");
    if (!taxTypePart || rest.length === 0) {
      return res.status(400).json({ error: "pid must be formatted as <taxType>-<periodId>" });
    }
    const taxType = taxTypePart.toUpperCase();
    const periodId = rest.join("-");
    const bundle = await buildEvidenceBundle(abn, taxType, periodId);
    return res.json({
      meta: {
        generated_at: new Date().toISOString(),
        abn,
        taxType,
        periodId,
      },
      evidence: bundle,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Evidence build failed" });
  }
});
