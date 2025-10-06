import nacl from "tweetnacl";

export interface RptPayload {
  entity_id: string;
  period_id: string;
  tax_type: "PAYGW" | "GST";
  amount_cents: number;
  merkle_root: string;
  running_balance_hash: string;
  anomaly_vector: Record<string, number>;
  thresholds: Record<string, number>;
  rail_id: "EFT" | "BPAY" | "PayTo";
  reference: string;
  expiry_ts: string;
  nonce: string;
  rates_version: string;
}

const encoder = new TextEncoder();

export function canonicalizeRptPayload(payload: RptPayload): string {
  return JSON.stringify(payload);
}

export function encodeRptPayload(payload: RptPayload): Uint8Array {
  return encoder.encode(canonicalizeRptPayload(payload));
}

export function signDetached(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, secretKey);
}

export function verifyDetached(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  return nacl.sign.detached.verify(message, signature, publicKey);
}

export function signRpt(payload: RptPayload, secretKey: Uint8Array): string {
  const sig = signDetached(encodeRptPayload(payload), secretKey);
  return Buffer.from(sig).toString("base64url");
}

export function verifyRpt(payload: RptPayload, signatureB64: string, publicKey: Uint8Array): boolean {
  const sig = Buffer.from(signatureB64, "base64url");
  return verifyDetached(encodeRptPayload(payload), sig, publicKey);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isExpired(iso: string): boolean {
  return Date.now() > Date.parse(iso);
}
