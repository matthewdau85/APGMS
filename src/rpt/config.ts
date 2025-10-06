export const FEATURE_ATO_TABLES = /^true$/i.test(process.env.FEATURE_ATO_TABLES ?? "");
export const RATES_VERSION = process.env.RATES_VERSION ?? "1";
export const RPT_TTL_SECONDS = Number(process.env.RPT_TTL_SECONDS ?? 15 * 60);
