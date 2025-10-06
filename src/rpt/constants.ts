export const RATES_VERSION = process.env.RATES_VERSION ?? "2025-10";
export const RPT_KID = process.env.RPT_ED25519_KID ?? "apgms-demo";
export const RPT_TTL_SECONDS = Number(process.env.RPT_TTL_SECONDS ?? 15 * 60);
export const RPT_ROTATION_GRACE_SECONDS = Number(process.env.RPT_ROTATION_GRACE_SECONDS ?? 5 * 60);
