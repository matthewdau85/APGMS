import { Router } from "express";
import { runtimeState } from "../runtime/state";

export const runtimeApi = Router();

runtimeApi.get("/runtime/summary", (_req, res) => {
  res.json(runtimeState.getSummary());
});

runtimeApi.get("/runtime/queues", (_req, res) => {
  res.json({ queues: runtimeState.listQueues() });
});

runtimeApi.post("/runtime/queues/:id/runbook", (req, res) => {
  const result = runtimeState.runRunbook(req.params.id);
  if (!result.allowed) {
    return res.status(result.status).json({ ok: false, message: result.message });
  }
  return res
    .status(result.status)
    .json({ ok: true, message: result.message, queue: result.queue });
});
