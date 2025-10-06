const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function firstEnv(keys: string[], fallback?: string) {
  for (const key of keys) {
    const value = (process.env as Record<string, string | undefined>)[key];
    if (value !== undefined) {
      return value;
    }
  }
  if (typeof import.meta !== "undefined") {
    const metaEnv = (import.meta as any)?.env ?? {};
    for (const key of keys) {
      const value = metaEnv[key];
      if (value !== undefined) {
        return value;
      }
    }
  }
  return fallback;
}

function flagEnabled(keys: string[]) {
  const value = firstEnv(keys);
  if (value === undefined) {
    return false;
  }
  return TRUE_VALUES.has(String(value).toLowerCase());
}

export function getRuntimeBanner() {
  const rawMode = (firstEnv([
    "REACT_APP_RUNTIME_MODE",
    "VITE_RUNTIME_MODE",
    "RUNTIME_MODE",
  ]) ?? "").toString().toUpperCase();

  const isPrototype = rawMode
    ? rawMode !== "REAL" && rawMode !== "PRODUCTION"
    : (process.env.NODE_ENV ?? "development") !== "production";

  const modeLabel = isPrototype ? "Prototype Mode" : "Real Mode";

  const dryRun = flagEnabled(["REACT_APP_DRY_RUN", "VITE_DRY_RUN", "DRY_RUN"]);
  const shadow = flagEnabled([
    "REACT_APP_SHADOW_ONLY",
    "VITE_SHADOW_ONLY",
    "SHADOW_ONLY",
  ]);

  const railsLabel = [
    dryRun ? "DRY_RUN" : null,
    shadow ? "SHADOW_ONLY" : null,
  ]
    .filter(Boolean)
    .join(" + ") || "LIVE";

  return {
    modeLabel,
    railsLabel,
    isPrototype,
    dryRun,
    shadow,
  };
}
