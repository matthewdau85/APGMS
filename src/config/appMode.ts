let mode = (process.env.APP_MODE || "sandbox").toLowerCase();

export function getAppMode(): "sandbox" | "real" | string {
  return mode;
}

export function setAppMode(next: string) {
  const normalised = next.toLowerCase();
  if (!["sandbox", "real"].includes(normalised)) {
    throw new Error("INVALID_MODE");
  }
  mode = normalised;
  process.env.APP_MODE = normalised;
}

export function isRealMode(): boolean {
  return getAppMode() === "real";
}
