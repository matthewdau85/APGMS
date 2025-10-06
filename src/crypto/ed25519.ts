import nacl from "tweetnacl";

export interface RptPayload {
  entity_id: string; period_id: string; tax_type: "PAYGW"|"GST";
  amount_cents: number; merkle_root: string; running_balance_hash: string;
  anomaly_vector: Record<string, number>; thresholds: Record<string, number>;
  rail_id: "EFT"|"BPAY"|"PayTo"; reference: string; expiry_ts: string; nonce: string;
  rates_version_id: string; rates_checksum: string;
}

export function signRpt(payload: RptPayload, secretKey: Uint8Array): string {
  const msg = new TextEncoder().encode(JSON.stringify(payload));
  const sig = nacl.sign.detached(msg, secretKey);
  return Buffer.from(sig).toString("base64url");
}

export function verifyRpt(payload: RptPayload, signatureB64: string, publicKey: Uint8Array): boolean {
  const msg = new TextEncoder().encode(JSON.stringify(payload));
  const sig = Buffer.from(signatureB64, "base64url");
  return nacl.sign.detached.verify(msg, sig, publicKey);
}

export function nowIso(): string { return new Date().toISOString(); }
export function isExpired(iso: string): boolean { return Date.now() > Date.parse(iso); }
