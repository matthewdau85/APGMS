import nacl from "tweetnacl";
import { canonicalizePayload, RptPayload } from "../../shared/security/rptKms.js";

export function verifyRpt(payload: RptPayload, signatureB64: string, publicKey: Uint8Array): boolean {
  const canonical = canonicalizePayload(payload);
  const msg = new TextEncoder().encode(canonical);
  const sig = Buffer.from(signatureB64, "base64");
  return nacl.sign.detached.verify(msg, sig, publicKey);
}

export function nowIso(): string { return new Date().toISOString(); }
export function isExpired(iso: string): boolean { return Date.now() > Date.parse(iso); }
