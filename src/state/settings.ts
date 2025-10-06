export type AppMode = "demo" | "real";

let appMode: AppMode = process.env.APP_MODE === "real" ? "real" : "demo";

export function getAppMode(): AppMode {
  return appMode;
}

export function setAppMode(next: AppMode) {
  appMode = next;
}
