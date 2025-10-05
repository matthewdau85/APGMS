import { Router } from "express";
import { payto } from "../payto/adapter";
export const router = Router();

router.post("/mandates", async (req, res) => {
  try {
    const { abn, payid, creditorName, maxAmountCents } = req.body ?? {};
    if (!abn || !payid || !creditorName || maxAmountCents === undefined) {
      return res.status(400).json({ error: "missing fields" });
    }
    const max = Number(maxAmountCents);
    if (!Number.isFinite(max) || max <= 0) {
      return res.status(400).json({ error: "invalid maxAmountCents" });
    }
    res.json(await payto.createMandate(abn, payid, creditorName, max));
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "failed to create mandate" });
  }
});

router.post("/mandates/:id/cancel", async (req, res) => {
  try {
    await payto.cancelMandate(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "failed to cancel" });
  }
});

router.post("/mandates/:id/sweep", async (req, res) => {
  try {
    const { amountCents, ref } = req.body ?? {};
    const amount = Number(amountCents);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "invalid amountCents" });
    }
    res.json(await payto.sweep(req.params.id, amount, String(ref || "")));
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "failed to sweep" });
  }
});
