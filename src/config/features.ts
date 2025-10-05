const flag = String(process.env.FEATURE_API_V2 || "").toLowerCase();
const truthy = new Set(["1", "true", "on", "yes"]);

export const FEATURES = {
  API_V2: truthy.has(flag),
} as const;
