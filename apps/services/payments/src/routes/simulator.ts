import type { Request, Response } from "express";
import { AdapterMode, AdapterName, getAdapterModes, setAdapterMode } from "../bank/simulatorState.js";

const adapters: AdapterName[] = ["bank", "payto", "payroll", "pos"];
const modes: AdapterMode[] = ["success", "insufficient", "error"];

export function getSimulatorModes(_req: Request, res: Response) {
  res.json({ modes: getAdapterModes() });
}

export function updateSimulatorMode(req: Request, res: Response) {
  const { adapter, mode } = req.body || {};
  if (!adapters.includes(adapter)) {
    return res.status(400).json({ error: "UNKNOWN_ADAPTER" });
  }
  if (!modes.includes(mode)) {
    return res.status(400).json({ error: "UNKNOWN_MODE" });
  }
  setAdapterMode(adapter, mode);
  res.json({ ok: true, modes: getAdapterModes() });
}
