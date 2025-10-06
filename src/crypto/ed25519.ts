import nacl from "tweetnacl";

export interface RptTotals {
  credited_to_owa_cents: number;
  net_cents: number;
  final_liability_cents: number;
  accrued_cents: number;
}

export interface RptPayload {
  abn: string;
  tax_type: "PAYGW" | "GST";
  period_id: string;
  totals: RptTotals;
  rates_version: string;
  nonce: string;
  exp: string;
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
