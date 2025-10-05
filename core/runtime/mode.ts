export type RuntimeMode = "mock" | "shadow" | "real";

const VALID_MODES: RuntimeMode[] = ["mock", "shadow", "real"];

export function normaliseMode(mode: string | undefined): RuntimeMode {
  if (!mode) return "mock";
  const lowered = mode.toLowerCase();
  if (VALID_MODES.includes(lowered as RuntimeMode)) {
    return lowered as RuntimeMode;
  }
  return "mock";
}

export function getRuntimeMode(): RuntimeMode {
  return normaliseMode(process.env.APGMS_RUNTIME_MODE);
}

export function setRuntimeMode(mode: RuntimeMode) {
  process.env.APGMS_RUNTIME_MODE = mode;
}
