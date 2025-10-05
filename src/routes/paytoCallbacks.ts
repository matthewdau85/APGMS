import { Router, Request, Response } from "express";
import { handlePaytoWebhook, verifyPaytoSignature } from "../payto/adapter";

function getSignature(req: Request): string {
  return (
    req.header("x-payto-signature") ||
    req.header("payto-signature") ||
    req.header("x-signature") ||
    req.header("signature") ||
    ""
  );
}

export const paytoCallbacks = Router();

paytoCallbacks.post("/", async (req: Request, res: Response) => {
  try {
    const rawBody = (req as any).rawBody;
    if (typeof rawBody !== "string") {
      return res.status(400).json({ error: "RAW_BODY_REQUIRED" });
    }

    const signature = getSignature(req);
    if (!signature) {
      return res.status(401).json({ error: "SIGNATURE_REQUIRED" });
    }

    const valid = await verifyPaytoSignature(rawBody, signature);
    if (!valid) {
      return res.status(401).json({ error: "INVALID_SIGNATURE" });
    }

    await handlePaytoWebhook(req.body);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ error: String(e?.message || e) });
  }
});
