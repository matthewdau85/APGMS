import { Request, Response, Router } from "express";
import { AuthenticatedUser } from "../auth/types";
import { recordApproval } from "../services/approvals";

export const approvalsRouter = Router();

approvalsRouter.post("/releases", async (req: Request, res: Response) => {
  try {
    const user = req.user as AuthenticatedUser | undefined;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { abn, taxType, periodId, amountCents, reason } = req.body || {};
    if (!abn || !taxType || !periodId || !Number.isFinite(Number(amountCents))) {
      return res.status(400).json({ error: "Missing fields" });
    }
    const release = { abn, taxType, periodId, amountCents: Number(amountCents) };
    const hash = await recordApproval(release, user.sub, user.name, reason);
    res.json({ ok: true, hash });
  } catch (err: any) {
    res.status(500).json({ error: "Approval failed", detail: String(err?.message || err) });
  }
});
