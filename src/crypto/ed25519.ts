import nacl from "tweetnacl";

export interface RptPayload {
  entity_id: string; period_id: string; tax_type: "PAYGW"|"GST";
  amount_cents: number; merkle_root: string; running_balance_hash: string;
  anomaly_vector: Record<string, number>; thresholds: Record<string, number>;
  rail_id: "EFT"|"BPAY"|"PayTo"; reference: string; expiry_ts: string; nonce: string;
}

function canonicalise(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    Object.keys(value).sort().forEach(key => {
      out[key] = canonicalise(value[key]);
    });
    return out;
  }
  return value;
}

export function canonicalJson(payload: RptPayload): string {
  return JSON.stringify(canonicalise(payload));
}

function normalizeSecret(secretKey: Uint8Array): Uint8Array {
  if (secretKey.length === 64) return secretKey;
  if (secretKey.length === 32) {
    return nacl.sign.keyPair.fromSeed(secretKey).secretKey;
  }
  throw new Error(`Ed25519 secret key must be 32 or 64 bytes (got ${secretKey.length})`);
}

function normalizePublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length === 32) return publicKey;
  throw new Error(`Ed25519 public key must be 32 bytes (got ${publicKey.length})`);
}

export function signRpt(payload: RptPayload, secretKey: Uint8Array): string {
  const msg = new TextEncoder().encode(canonicalJson(payload));
  const sig = nacl.sign.detached(msg, normalizeSecret(secretKey));
  return Buffer.from(sig).toString("base64url");
}

export function verifyRpt(payload: RptPayload, signatureB64: string, publicKey: Uint8Array): boolean {
  const msg = new TextEncoder().encode(canonicalJson(payload));
  const sig = Buffer.from(signatureB64, "base64url");
  return nacl.sign.detached.verify(msg, sig, normalizePublicKey(publicKey));
}

export function nowIso(): string { return new Date().toISOString(); }
export function isExpired(iso: string): boolean { return Date.now() > Date.parse(iso); }
