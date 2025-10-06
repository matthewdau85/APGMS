import express from "express";
import { POSScenario, SimPOS } from "../sim/pos/SimPOS";
import { PayrollScenario, SimPayroll } from "../sim/payroll/SimPayroll";
import { listDlqEvents, listGateStates, listReconInputs, retryDlq } from "../adapters/recon/ReconEngine";

export const simApi = express.Router();

simApi.get("/recon-inputs", (_req, res) => {
  res.json({ items: listReconInputs() });
});

simApi.get("/gates", (_req, res) => {
  res.json({ gates: listGateStates() });
});

simApi.get("/dlq", (_req, res) => {
  res.json({ events: listDlqEvents() });
});

simApi.post("/dlq/:id/retry", (req, res) => {
  try {
    const result = retryDlq(req.params.id);
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(404).json({ error: err?.message || "DLQ_NOT_FOUND" });
  }
});

simApi.post("/payroll/:scenario", async (req, res) => {
  const scenario = req.params.scenario as PayrollScenario;
  const advanceWeeksRaw = req.query.advanceWeeks;
  const advanceWeeks = advanceWeeksRaw !== undefined ? Number(advanceWeeksRaw) : undefined;
  if (advanceWeeks !== undefined && Number.isNaN(advanceWeeks)) {
    return res.status(400).json({ error: "advanceWeeks must be numeric" });
  }
  try {
    const result = await SimPayroll.trigger(scenario, { advanceWeeks });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "SIM_FAILED" });
  }
});

simApi.post("/pos/:scenario", async (req, res) => {
  const scenario = req.params.scenario as POSScenario;
  const advanceWeeksRaw = req.query.advanceWeeks;
  const advanceWeeks = advanceWeeksRaw !== undefined ? Number(advanceWeeksRaw) : undefined;
  if (advanceWeeks !== undefined && Number.isNaN(advanceWeeks)) {
    return res.status(400).json({ error: "advanceWeeks must be numeric" });
  }
  try {
    const result = await SimPOS.trigger(scenario, { advanceWeeks });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "SIM_FAILED" });
  }
});
