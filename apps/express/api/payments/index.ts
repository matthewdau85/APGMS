import { Router } from "express";
import { getFeatureFlags, getProviderRegistry } from "@core/providers/registry";
import type { PayCommand, RefundCommand } from "@core/ports";

export const router = Router();

router.post("/pay", async (req, res, next) => {
  try {
    const flags = getFeatureFlags();
    if (flags.protoKillSwitch) {
      return res.status(503).json({ error: "payments_disabled", reason: "PROTO_KILL_SWITCH" });
    }
    const { bank } = getProviderRegistry();
    const payload = (req.body ?? {}) as PayCommand;
    const receipt = await bank.pay(payload);
    res.status(202).json(receipt);
  } catch (error) {
    next(error);
  }
});

router.get("/pay/:id", async (req, res, next) => {
  try {
    const { bank } = getProviderRegistry();
    const record = await bank.getPayment(req.params.id);
    if (!record) {
      return res.status(404).json({ error: "payment_not_found", id: req.params.id });
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

router.post("/refund", async (req, res, next) => {
  try {
    const flags = getFeatureFlags();
    if (flags.protoKillSwitch) {
      return res.status(503).json({ error: "payments_disabled", reason: "PROTO_KILL_SWITCH" });
    }
    const { bank } = getProviderRegistry();
    const payload = (req.body ?? {}) as RefundCommand;
    const receipt = await bank.refund(payload);
    res.status(202).json(receipt);
  } catch (error) {
    next(error);
  }
});
