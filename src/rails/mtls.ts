import fs from "fs";
import path from "path";
import https from "https";

function loadPem(value?: string): Buffer | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("-----BEGIN")) {
    return Buffer.from(trimmed);
  }
  const possiblePath = path.resolve(trimmed);
  if (fs.existsSync(possiblePath)) {
    return fs.readFileSync(possiblePath);
  }
  // assume base64 encoded
  try {
    return Buffer.from(trimmed, "base64");
  } catch {
    return Buffer.from(trimmed);
  }
}

export function createMtlsAgent(): https.Agent {
  const cert = loadPem(process.env.MTLS_CERT);
  const key = loadPem(process.env.MTLS_KEY);
  const ca = loadPem(process.env.MTLS_CA);

  return new https.Agent({
    cert,
    key,
    ca,
    rejectUnauthorized: true,
  });
}

export const mtlsAgent = createMtlsAgent();
