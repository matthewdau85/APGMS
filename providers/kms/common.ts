import { createPublicKey, KeyObject } from "node:crypto";

const RAW_ENV_KEYS = [
  "ED25519_PUBLIC_KEY_BASE64",
  "RPT_PUBLIC_BASE64",
  "ED25519_PUB_RAW_BASE64",
];
const PEM_ENV_KEYS = [
  "ED25519_PUBLIC_KEY_PEM",
  "RPT_PUBLIC_KEY_PEM",
];

function getFirstEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value.trim();
  }
  return undefined;
}

function spkiFromRawEd25519(raw: Buffer): Buffer {
  const prefix = Buffer.from([
    0x30, 0x2a,
    0x30, 0x05,
    0x06, 0x03, 0x2b, 0x65, 0x70,
    0x03, 0x21, 0x00,
  ]);
  return Buffer.concat([prefix, raw]);
}

function pemFromSpki(spki: Buffer): string {
  const base64 = spki.toString("base64");
  const wrapped = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`;
}

export function loadEd25519PublicKeyObject(): KeyObject {
  const pem = getFirstEnv(PEM_ENV_KEYS);
  if (pem) {
    return createPublicKey(pem);
  }

  const rawBase64 = getFirstEnv(RAW_ENV_KEYS);
  if (!rawBase64) {
    throw new Error(
      "No Ed25519 public key configured. Set ED25519_PUBLIC_KEY_PEM or ED25519_PUBLIC_KEY_BASE64"
    );
  }
  const raw = Buffer.from(rawBase64, "base64");
  if (raw.length !== 32) {
    throw new Error(`Ed25519 raw key must be 32 bytes (got ${raw.length})`);
  }
  const pemFromRaw = pemFromSpki(spkiFromRawEd25519(raw));
  return createPublicKey(pemFromRaw);
}

export function loadEd25519RawPublicKey(): Uint8Array {
  const rawBase64 = getFirstEnv(RAW_ENV_KEYS);
  if (rawBase64) {
    const raw = Buffer.from(rawBase64, "base64");
    if (raw.length !== 32) {
      throw new Error(`Ed25519 raw key must be 32 bytes (got ${raw.length})`);
    }
    return raw;
  }
  const keyObject = loadEd25519PublicKeyObject();
  const spki = keyObject.export({ format: "der", type: "spki" }) as Buffer;
  return spki.subarray(spki.length - 32);
}

export const SIGNATURE_INVALID_CODE = "SIGNATURE_INVALID";
