let currentMode = (process.env.APP_MODE || "demo").toLowerCase();

export function getAppMode(): string {
  return currentMode;
}

export function setAppMode(mode: string): string {
  currentMode = mode.toLowerCase();
  process.env.APP_MODE = currentMode;
  return currentMode;
}
