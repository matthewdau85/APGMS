import { NextFunction, Request, Response } from "express";
import { FEATURES, isAnySimulationEnabled } from "../config/features";

export function modeHeaders(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader("x-app-mode", FEATURES.APP_MODE);
  res.setHeader("x-simulated", String(isAnySimulationEnabled()));
  res.setHeader("x-dry-run", String(FEATURES.DRY_RUN));

  next();
}
