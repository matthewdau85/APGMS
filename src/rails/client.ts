import https from "https";
const ALLOW = new Set<string>((process.env.ALLOWLIST_ABNS || "").split(",").filter(Boolean));
export function assertAllowed(abn: string) {
  if (!ALLOW.has(abn)) throw new Error("abn_not_allowlisted");
}
export function mtlsAgent() {
  return new https.Agent({
    cert: process.env.MTLS_CERT,
    key: process.env.MTLS_KEY,
    ca: process.env.MTLS_CA,
    rejectUnauthorized: true,
  });
}
