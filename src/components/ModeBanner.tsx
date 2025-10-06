// src/components/ModeBanner.tsx
import React from "react";

type ModeFlags = {
  mode?: string;
  dryRun: boolean;
  shadowOnly: boolean;
};

function readFlags(): ModeFlags {
  const globalAny = globalThis as any;
  const meta = typeof import.meta !== "undefined" ? (import.meta as any) : undefined;
  const env = meta?.env ?? {};

  const mode = env.VITE_APP_MODE || env.APP_MODE || globalAny.APP_MODE;
  const dryRunValue = env.VITE_DRY_RUN ?? env.DRY_RUN ?? globalAny.DRY_RUN;
  const shadowValue = env.VITE_SHADOW_ONLY ?? env.SHADOW_ONLY ?? globalAny.SHADOW_ONLY;

  return {
    mode: typeof mode === "string" ? mode : undefined,
    dryRun: toBool(dryRunValue),
    shadowOnly: toBool(shadowValue),
  };
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

export function ModeBanner() {
  const { mode, dryRun, shadowOnly } = readFlags();
  const labels: string[] = [];
  if (mode && mode.toLowerCase() !== "production") {
    labels.push(mode.toUpperCase());
  } else if (mode && (dryRun || shadowOnly)) {
    labels.push(mode.toUpperCase());
  }
  if (dryRun) labels.push("DRY RUN");
  if (shadowOnly) labels.push("SHADOW ONLY");

  if (labels.length === 0) return null;

  return (
    <div className="mode-banner" role="status">
      <span>{labels.join(" • ")}</span>
    </div>
  );
}
