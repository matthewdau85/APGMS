import type { Request, Response, NextFunction } from "express";
import { latestConsent, requireConsent, ConsentRequiredError, type ConsentAcceptance } from "../consent/service";

export type RailsMode = {
  simulated: boolean;
  consent?: ConsentAcceptance | null;
};

const MODE = (process.env.RAILS_MODE || "simulated").toLowerCase();

async function resolveMode(): Promise<RailsMode> {
  switch (MODE) {
    case "force-real":
    case "live":
    case "real": {
      const consent = await requireConsent();
      return { simulated: false, consent };
    }
    case "force-simulated":
    case "simulated":
    default:
      return { simulated: true, consent: await latestConsent() };
  }
}

export async function isSimulatedRails(): Promise<boolean> {
  const { simulated } = await resolveMode();
  return simulated;
}

export function railsContext() {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await resolveMode();
      res.locals.simulated = ctx.simulated;
      res.locals.railsConsent = ctx.consent;
      next();
    } catch (error) {
      if (error instanceof ConsentRequiredError) {
        res.locals.simulated = true;
      }
      next(error);
    }
  };
}

export async function ensureRealRailsAllowed() {
  if (MODE === "real" || MODE === "force-real" || MODE === "live") {
    await requireConsent();
  }
}
