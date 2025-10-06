import nacl from "tweetnacl";
import { canonicalJson } from "../utils/c14n";

export interface CanonicalRptPayload {
  abn: string;
  tax_type: "PAYGW" | "GST";
  period_id: string;
  totals: Record<string, unknown>;
  rates_version: string;
  nonce: string;
  exp: string;
}

export const DEV_RPT_SECRET_BASE64 =
  "RALIpN6tiUu7C5wn2e8YEb5/NwPt0nUMHy1qlEBHlymb5ZDNAELVEMNFcUIUOZGFGalDe6PAnpgJfR5PEe2F3w==";
export const DEV_RPT_PUBLIC_BASE64 = "m+WQzQBC1RDDRXFCFDmRhRmpQ3ujwJ6YCX0eTxHthd8=";

export function canonicalizeRpt(payload: CanonicalRptPayload): string {
  return canonicalJson(payload);
}

export function signCanonicalRpt(canonical: string, secretKey: Uint8Array): string {
  const msg = new TextEncoder().encode(canonical);
  const sig = nacl.sign.detached(msg, secretKey);
  return Buffer.from(sig).toString("base64url");
}

export function verifyCanonicalRpt(canonical: string, signatureB64: string, publicKey: Uint8Array): boolean {
  const msg = new TextEncoder().encode(canonical);
  const sig = Buffer.from(signatureB64, "base64url");
  return nacl.sign.detached.verify(msg, sig, publicKey);
}

export function secretKeyFromBase64(base64?: string): Uint8Array {
  const src = base64 || DEV_RPT_SECRET_BASE64;
  const buf = Buffer.from(src, "base64");
  if (buf.length !== 64) {
    throw new Error("RPT secret must be 64 bytes (base64 encoded)");
  }
  return new Uint8Array(buf);
}

export function publicKeyFromBase64(base64?: string): Uint8Array {
  const src = base64 || DEV_RPT_PUBLIC_BASE64;
  const buf = Buffer.from(src, "base64");
  if (buf.length !== 32) {
    throw new Error("RPT public key must be 32 bytes (base64 encoded)");
  }
  return new Uint8Array(buf);
}

export function derivePublicKey(secretKey: Uint8Array): Uint8Array {
  const kp = nacl.sign.keyPair.fromSecretKey(secretKey);
  return kp.publicKey;
}
