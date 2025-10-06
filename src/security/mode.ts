export type RuntimeMode = "sandbox" | "real";

let currentMode: RuntimeMode = process.env.APP_MODE === "real" ? "real" : "sandbox";

export function getMode(): RuntimeMode {
  return currentMode;
}

export function setMode(mode: RuntimeMode): RuntimeMode {
  currentMode = mode;
  return currentMode;
}
