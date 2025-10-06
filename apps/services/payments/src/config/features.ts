import type { Console } from "node:console";

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export interface FeatureToggles {
  simOutbound: boolean;
  allowUnsafe: boolean;
}

function readToggles(): FeatureToggles {
  return {
    simOutbound: parseBool(process.env.FEATURE_SIM_OUTBOUND),
    allowUnsafe: parseBool(process.env.ALLOW_UNSAFE),
  };
}

export function getFeatureToggles(): FeatureToggles {
  return readToggles();
}

export function assertSafeCombo(): void {
  const toggles = readToggles();
  const appMode = (process.env.APP_MODE || "sim").toLowerCase();
  if (appMode === "real" && toggles.simOutbound && !toggles.allowUnsafe) {
    throw new Error("Unsafe feature combination: FEATURE_SIM_OUTBOUND cannot run in APP_MODE=real without ALLOW_UNSAFE=true");
  }
}

export function logFeatureToggles(logger: Pick<Console, "log"> = console): void {
  const toggles = readToggles();
  const parts = [
    `APP_MODE=${process.env.APP_MODE ?? ""}`.trim(),
    `FEATURE_SIM_OUTBOUND=${toggles.simOutbound}`,
    `ALLOW_UNSAFE=${toggles.allowUnsafe}`,
  ];
  logger.log(`[features] ${parts.filter(Boolean).join(" ")}`.trim());
}
