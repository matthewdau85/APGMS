import "../../loadEnv.js";
import { createPublicKey, KeyObject, verify as cryptoVerify } from "node:crypto";
import { KmsPort, KmsSignParams, KmsVerifyParams } from "@core/ports";

function spkiFromRawEd25519(raw: Buffer): Buffer {
  const prefix = Buffer.from([
    0x30, 0x2a,
    0x30, 0x05,
    0x06, 0x03, 0x2b, 0x65, 0x70,
    0x03, 0x21, 0x00
  ]);
  return Buffer.concat([prefix, raw]);
}

function pemFromSpki(spki: Buffer): string {
  const b64 = spki.toString("base64").match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
}

function loadPublicKey(): KeyObject {
  const pem = process.env.ED25519_PUBLIC_KEY_PEM || process.env.RPT_PUBLIC_KEY_PEM;
  const raw64 = process.env.ED25519_PUBLIC_KEY_BASE64 || process.env.RPT_PUBLIC_BASE64;

  if (pem) return createPublicKey(pem);

  if (raw64) {
    const raw = Buffer.from(raw64, "base64");
    if (raw.length !== 32) {
      throw new Error(`RPT_PUBLIC_BASE64 must be 32 bytes (got ${raw.length})`);
    }
    const spki = spkiFromRawEd25519(raw);
    return createPublicKey(pemFromSpki(spki));
  }

  throw new Error("No public key found. Set ED25519_PUBLIC_KEY_PEM or RPT_PUBLIC_BASE64 in .env.local");
}

class LocalKmsPort implements KmsPort {
  private readonly key: KeyObject;

  constructor() {
    this.key = loadPublicKey();
  }

  getCapabilities(): string[] {
    return ["mock", "verify-ed25519"];
  }

  async verify({ payload, signature }: KmsVerifyParams): Promise<boolean> {
    const message = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const sig = Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
    return cryptoVerify(null, message, this.key, sig);
  }

  async sign(_params: KmsSignParams): Promise<Uint8Array> {
    throw new Error("Mock KMS does not support signing");
  }
}

export function createMockKmsPort(): KmsPort {
  return new LocalKmsPort();
}
