import nacl from "tweetnacl";
import crypto from "crypto";

export interface RptPayload {
  entity_id: string; period_id: string; tax_type: "PAYGW"|"GST";
  amount_cents: number; merkle_root: string | null; running_balance_hash: string | null;
  anomaly_vector: Record<string, number>; thresholds: Record<string, number>;
  rail_id: "EFT"|"BPAY"|"PayTo"; reference: string; expiry_ts: string; expires_at?: string; nonce: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
}

export function signRpt(
  payload: RptPayload,
  secretKey: Uint8Array
): { signature: string; payload_c14n: string; payload_sha256: string } {
  const c14n = canonicalJson(payload);
  const msg = new TextEncoder().encode(c14n);
  const sig = nacl.sign.detached(msg, secretKey);
  const payload_sha256 = crypto.createHash("sha256").update(c14n).digest("hex");
  return { signature: Buffer.from(sig).toString("base64url"), payload_c14n: c14n, payload_sha256 };
}

export function verifyRpt(payload: RptPayload, signatureB64: string, publicKey: Uint8Array): boolean {
  const c14n = canonicalJson(payload);
  const msg = new TextEncoder().encode(c14n);
  const sig = Buffer.from(signatureB64, "base64url");
  return nacl.sign.detached.verify(msg, sig, publicKey);
}

export function nowIso(): string { return new Date().toISOString(); }
export function isExpired(iso: string): boolean { return Date.now() > Date.parse(iso); }
