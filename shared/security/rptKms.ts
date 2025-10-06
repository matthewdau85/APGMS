import { createHash } from 'node:crypto';
import { TextEncoder } from 'node:util';
import nacl from 'tweetnacl';

import type { SignCommandInput, VerifyCommandInput } from '@aws-sdk/client-kms';

let kmsClientSingleton: RptKms | null = null;

export type AssuranceLevel = 'aal1' | 'aal2' | 'aal3';

export interface RptPayload {
  entity_id: string;
  period_id: string;
  tax_type: 'PAYGW' | 'GST';
  amount_cents: number;
  merkle_root: string | null;
  running_balance_hash: string | null;
  anomaly_vector: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  rail_id: 'EFT' | 'BPAY' | 'PayTo';
  reference: string;
  expiry_ts: string;
  nonce: string;
}

export interface SignResult {
  signature: string;
  keyId: string;
}

export interface VerifyResult {
  valid: boolean;
}

export interface RptKms {
  getKeyId(): string;
  sign(payload: Uint8Array): Promise<Uint8Array>;
  verify(payload: Uint8Array, signature: Uint8Array, keyId?: string): Promise<boolean>;
}

export interface SignOptions {
  keyId?: string;
}

function textEncoder(): TextEncoder {
  // Node 18+ exposes global TextEncoder but import from util for compatibility.
  return new TextEncoder();
}

function canonicalOrder(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalOrder(item));
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, canonicalOrder(v)] as const);
  return Object.fromEntries(entries);
}

export function canonicalizePayload(payload: RptPayload): string {
  const ordered = canonicalOrder(payload);
  return JSON.stringify(ordered);
}

export function hashCanonicalPayload(c14n: string): string {
  return createHash('sha256').update(c14n).digest('hex');
}

class LocalRptKms implements RptKms {
  private readonly secretKey: Uint8Array;
  private readonly publicKey: Uint8Array;
  private readonly keyId: string;

  constructor() {
    const secretB64 = process.env.RPT_ED25519_SECRET_BASE64;
    if (!secretB64) {
      throw new Error('RPT_ED25519_SECRET_BASE64 is required when using local RPT signer');
    }
    const raw = Buffer.from(secretB64, 'base64');
    if (raw.length !== 32 && raw.length !== 64) {
      throw new Error(`RPT_ED25519_SECRET_BASE64 must be 32-byte seed or 64-byte secret key. Got ${raw.length}`);
    }
    if (raw.length === 32) {
      const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(raw));
      this.secretKey = pair.secretKey;
      this.publicKey = pair.publicKey;
    } else {
      this.secretKey = new Uint8Array(raw);
      this.publicKey = this.secretKey.slice(32);
    }
    this.keyId = process.env.RPT_KMS_KEY_ID || 'local-dev';
  }

  getKeyId(): string {
    return this.keyId;
  }

  async sign(payload: Uint8Array): Promise<Uint8Array> {
    return nacl.sign.detached(payload, this.secretKey);
  }

  async verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean> {
    return nacl.sign.detached.verify(payload, signature, this.publicKey);
  }
}

class AwsRptKms implements RptKms {
  private readonly clientPromise: Promise<typeof import('@aws-sdk/client-kms')>;
  private readonly keyId: string;

  constructor() {
    this.keyId = process.env.RPT_KMS_KEY_ID || process.env.KMS_KEY_ID || '';
    if (!this.keyId) {
      throw new Error('Set RPT_KMS_KEY_ID when using AWS KMS backend');
    }
    this.clientPromise = import('@aws-sdk/client-kms');
  }

  getKeyId(): string {
    return this.keyId;
  }

  private async getClient() {
    const mod = await this.clientPromise;
    const { KMSClient } = mod;
    const region = process.env.AWS_REGION || 'ap-southeast-2';
    return new KMSClient({ region });
  }

  async sign(payload: Uint8Array): Promise<Uint8Array> {
    const client = await this.getClient();
    const { SignCommand } = await this.clientPromise;
    const input: SignCommandInput = {
      KeyId: this.keyId,
      Message: payload,
      MessageType: 'RAW',
      SigningAlgorithm: 'EDDSA',
    };
    const res = await client.send(new SignCommand(input));
    if (!res.Signature) {
      throw new Error('AWS KMS SignCommand returned no signature');
    }
    return new Uint8Array(res.Signature as Uint8Array);
  }

  async verify(payload: Uint8Array, signature: Uint8Array, keyId = this.keyId): Promise<boolean> {
    const client = await this.getClient();
    const { VerifyCommand } = await this.clientPromise;
    const input: VerifyCommandInput = {
      KeyId: keyId,
      Message: payload,
      MessageType: 'RAW',
      Signature: signature,
      SigningAlgorithm: 'EDDSA',
    };
    const res = await client.send(new VerifyCommand(input));
    return Boolean(res.SignatureValid);
  }
}

class GcpRptKms implements RptKms {
  private readonly clientPromise: Promise<typeof import('@google-cloud/kms')>;
  private readonly keyVersionName: string;

  constructor() {
    this.keyVersionName = process.env.RPT_KMS_KEY_VERSION || '';
    if (!this.keyVersionName) {
      throw new Error('Set RPT_KMS_KEY_VERSION when using GCP KMS backend');
    }
    this.clientPromise = import('@google-cloud/kms');
  }

  getKeyId(): string {
    return this.keyVersionName;
  }

  private async getClient() {
    const mod = await this.clientPromise;
    const { KeyManagementServiceClient } = mod;
    return new KeyManagementServiceClient();
  }

  async sign(payload: Uint8Array): Promise<Uint8Array> {
    const client = await this.getClient();
    const [res] = await client.asymmetricSign({
      name: this.keyVersionName,
      digest: { sha256: createHash('sha256').update(payload).digest() },
    });
    if (!res.signature) {
      throw new Error('GCP KMS asymmetricSign returned no signature');
    }
    return new Uint8Array(res.signature);
  }

  async verify(payload: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const client = await this.getClient();
    const [publicKey] = await client.getPublicKey({ name: this.keyVersionName });
    if (!publicKey.pem) {
      throw new Error('GCP KMS public key PEM missing');
    }
    const { createPublicKey, verify } = await import('node:crypto');
    const key = createPublicKey(publicKey.pem);
    return verify(null, Buffer.from(payload), key, Buffer.from(signature));
  }
}

function backend(): string {
  return (process.env.RPT_KMS_BACKEND || process.env.KMS_BACKEND || 'local').toLowerCase();
}

export async function getRptKms(): Promise<RptKms> {
  if (kmsClientSingleton) {
    return kmsClientSingleton;
  }

  const backendName = backend();
  if (backendName === 'aws') {
    kmsClientSingleton = new AwsRptKms();
  } else if (backendName === 'gcp') {
    kmsClientSingleton = new GcpRptKms();
  } else {
    kmsClientSingleton = new LocalRptKms();
  }
  return kmsClientSingleton;
}

export async function signRptPayload(payload: RptPayload, opts: SignOptions = {}): Promise<{
  signature: string;
  keyId: string;
  canonical: string;
  payloadHash: string;
}> {
  const kms = await getRptKms();
  const canonical = canonicalizePayload(payload);
  const bytes = textEncoder().encode(canonical);
  const signature = await kms.sign(bytes);
  const keyId = opts.keyId || kms.getKeyId();
  return {
    signature: Buffer.from(signature).toString('base64'),
    keyId,
    canonical,
    payloadHash: hashCanonicalPayload(canonical),
  };
}

export async function verifyRptSignature(
  payloadCanonical: string,
  signatureB64: string,
  keyId?: string,
): Promise<boolean> {
  const kms = await getRptKms();
  const sig = Buffer.from(signatureB64, 'base64');
  const bytes = textEncoder().encode(payloadCanonical);
  return kms.verify(bytes, new Uint8Array(sig), keyId);
}

export function resetRptKms(): void {
  kmsClientSingleton = null;
}
