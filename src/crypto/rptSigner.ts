import nacl from "tweetnacl";
import { AwsKmsEd25519, KmsSigner } from "./kms";

export type TaxType = "PAYGW" | "GST";
export type RailId = "EFT" | "BPAY" | "PayTo";

export interface RptPayload {
  entity_id: string;
  period_id: string;
  tax_type: TaxType;
  amount_cents: number;
  merkle_root: string;
  running_balance_hash: string;
  anomaly_vector: Record<string, number>;
  thresholds: Record<string, number>;
  rail_id: RailId;
  reference: string;
  expiry_ts: string;
  nonce: string;
  rates_version: string;
}

export interface RptToken {
  kid: string;
  issuedAt: string;
  exp: string;
  payload: RptPayload;
}

export interface SignedRpt {
  token: RptToken;
  signature: string;
  canonical: string;
}

export interface SignOptions {
  issuedAt?: string;
  kidOverride?: string;
}

let signerPromise: Promise<{ signer: KmsSigner; kid: string }> | null = null;

function toPemFromRaw(raw: Uint8Array): string {
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  const der = Buffer.concat([prefix, Buffer.from(raw)]);
  const base64 = der.toString("base64");
  const chunks = base64.match(/.{1,64}/g) ?? [];
  const joined = chunks.join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${joined}\n-----END PUBLIC KEY-----`;
}

class LocalEd25519Signer implements KmsSigner {
  private readonly secretKey: Uint8Array;
  private readonly publicKey: Uint8Array;
  private readonly pem: string;

  constructor(secretBase64: string) {
    if (!secretBase64) {
      throw new Error("RPT_ED25519_SECRET_BASE64 must be set for local signing");
    }
    const buf = Buffer.from(secretBase64, "base64");
    if (buf.length === 64) {
      this.secretKey = new Uint8Array(buf);
      this.publicKey = this.secretKey.slice(32);
    } else if (buf.length === 32) {
      const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(buf));
      this.secretKey = kp.secretKey;
      this.publicKey = kp.publicKey;
    } else {
      throw new Error(`RPT_ED25519_SECRET_BASE64 must decode to 32 or 64 bytes (got ${buf.length})`);
    }
    this.pem = toPemFromRaw(this.publicKey);
  }

  async sign(payload: Uint8Array): Promise<Uint8Array> {
    return nacl.sign.detached(payload, this.secretKey);
  }

  async getPublicKeyPEM(): Promise<string> {
    return this.pem;
  }

  getPublicKeyRaw(): Uint8Array {
    return this.publicKey;
  }
}

function canonicalizeValue(value: any): string {
  if (value === null) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Cannot canonicalize non-finite numbers");
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalizeValue(item)).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${canonicalizeValue(value[key])}`)
    .join(",");
  return `{${body}}`;
}

export function canonicalizeRptToken(token: RptToken): string {
  return canonicalizeValue(token);
}

async function getSigner(): Promise<{ signer: KmsSigner; kid: string }> {
  if (!signerPromise) {
    const useKms = String(process.env.FEATURE_KMS ?? "").toLowerCase() === "true";
    if (useKms) {
      const keyId = process.env.RPT_KMS_KEY_ID;
      if (!keyId) {
        throw new Error("RPT_KMS_KEY_ID must be set when FEATURE_KMS is enabled");
      }
      const signer = new AwsKmsEd25519({ keyId });
      signerPromise = Promise.resolve({ signer, kid: keyId });
    } else {
      const secret = process.env.RPT_ED25519_SECRET_BASE64 || "";
      const kid = process.env.RPT_LOCAL_KEY_ID || process.env.RPT_KMS_KEY_ID || "local-dev";
      const signer = new LocalEd25519Signer(secret);
      signerPromise = Promise.resolve({ signer, kid });
    }
  }
  return signerPromise;
}

const encoder = new TextEncoder();

export function canonicalToBytes(canonical: string): Uint8Array {
  return encoder.encode(canonical);
}

export async function signRptPayload(payload: RptPayload, options: SignOptions = {}): Promise<SignedRpt> {
  const { signer, kid: resolvedKid } = await getSigner();
  const issuedAt = options.issuedAt ?? new Date().toISOString();
  const kid = options.kidOverride ?? resolvedKid;
  if (!payload.expiry_ts) {
    throw new Error("RPT payload must include expiry_ts");
  }
  const token: RptToken = {
    kid,
    issuedAt,
    exp: payload.expiry_ts,
    payload,
  };
  const canonical = canonicalizeRptToken(token);
  const bytes = canonicalToBytes(canonical);
  const sig = await signer.sign(bytes);
  const signature = Buffer.from(sig).toString("base64url");
  return { token, signature, canonical };
}

export async function currentPublicKeyPem(): Promise<string> {
  const { signer } = await getSigner();
  return signer.getPublicKeyPEM();
}

export function rawPublicKeyToPem(raw: Uint8Array): string {
  return toPemFromRaw(raw);
}

export function resetRptSignerForTests(): void {
  signerPromise = null;
}
