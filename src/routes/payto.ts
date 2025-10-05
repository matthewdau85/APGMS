import { Router } from "express";
import { payto } from "../payto/adapter";
export const router = Router();

router.post("/mandates", async (req, res) => {
  const { abn, payid, creditorName, maxAmountCents } = req.body ?? {};
  if (!abn || !payid || !creditorName || maxAmountCents == null) return res.status(400).json({ error: "missing fields" });
  res.json(await payto.createMandate(abn, payid, creditorName, Number(maxAmountCents)));
});
router.post("/mandates/:id/cancel", async (req, res) => {
  await payto.cancelMandate(req.params.id);
  res.json({ ok: true });
});
router.post("/mandates/:id/sweep", async (req, res) => {
  const { amountCents, ref } = req.body ?? {};
  if (amountCents == null) return res.status(400).json({ error: "amountCents required" });
  res.json(await payto.sweep(req.params.id, Number(amountCents), String(ref || "")));
});
