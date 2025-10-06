export interface ComplianceState {
  appMode: string;
  dspOk: boolean;
  showPrototypeBanner: boolean;
}

const truthyValues = new Set(["1", "true", "yes", "y", "on", "ok", "approved"]);
const falsyValues = new Set(["0", "false", "no", "n", "off"]);

function readGlobalKey(key: string): unknown {
  if (typeof globalThis !== "undefined") {
    const globalAny = globalThis as Record<string, unknown>;
    if (globalAny[key] !== undefined) {
      return globalAny[key];
    }
    if (globalAny.window && (globalAny.window as Record<string, unknown>)[key] !== undefined) {
      return (globalAny.window as Record<string, unknown>)[key];
    }
    const processLike = (globalAny.process as { env?: Record<string, unknown> }) || undefined;
    if (processLike?.env && processLike.env[key] !== undefined) {
      return processLike.env[key];
    }
  }
  return undefined;
}

function readEnvString(keys: string[], fallback?: string): string | undefined {
  for (const key of keys) {
    const value = readGlobalKey(key);
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return fallback;
}

function readEnvBoolean(keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const value = readGlobalKey(key);
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "boolean") {
      return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (truthyValues.has(normalized)) {
      return true;
    }
    if (falsyValues.has(normalized)) {
      return false;
    }
  }
  return fallback;
}

export function getComplianceState(): ComplianceState {
  const appMode = (readEnvString([
    "APP_MODE",
    "REACT_APP_APP_MODE",
    "VITE_APP_MODE",
    "NEXT_PUBLIC_APP_MODE",
    "APP_STAGE",
  ]) || "prototype").toLowerCase();

  const dspOk = readEnvBoolean([
    "DSP_OK",
    "REACT_APP_DSP_OK",
    "VITE_DSP_OK",
    "NEXT_PUBLIC_DSP_OK",
    "DSP_APPROVED",
  ]);

  const showPrototypeBanner = !(appMode === "real" && dspOk);

  return {
    appMode,
    dspOk,
    showPrototypeBanner,
  };
}

export function getComplianceCopy(): {
  subtitle: string;
  footer: string;
} {
  const { dspOk, showPrototypeBanner } = getComplianceState();

  if (dspOk && !showPrototypeBanner) {
    return {
      subtitle: "ATO-accredited deployment with DSP approvals in place.",
      footer: "© 2025 APGMS | Accredited for Income Tax Assessment Act 1997 & GST Act 1999 obligations.",
    };
  }

  return {
    subtitle: "Prototype environment – workflows are for evaluation and accreditation preparation only.",
    footer: "© 2025 APGMS | Prototype build pending DSP accreditation; do not rely on this system for statutory lodgments.",
  };
}
