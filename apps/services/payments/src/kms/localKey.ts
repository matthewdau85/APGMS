import "../loadEnv.js";
import {
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import nacl from "tweetnacl";
import type { IKms } from "./IKms";

/** Wrapper for local signing/verifying backed by env-configured Ed25519 keys. */
export class LocalKeyProvider implements IKms {
  private publicKey: KeyObject;
  private publicKeyRaw: Uint8Array;
  private privateKey?: KeyObject;
  private secretKey?: Uint8Array;

  constructor() {
    const { keyObject, rawKey } = loadPublicKey();
    this.publicKey = keyObject;
    this.publicKeyRaw = rawKey;
    const signing = loadSigningMaterial();
    this.privateKey = signing.privateKey;
    this.secretKey = signing.secretKey;
  }

  async verify(payload: Buffer, signature: Buffer, _kid?: string): Promise<boolean>;
  async verify(kid: string, message: Uint8Array, signature: Uint8Array): Promise<boolean>;
  async verify(arg1: Buffer | string, arg2: Buffer | Uint8Array, arg3?: Uint8Array | string): Promise<boolean> {
    if (typeof arg1 === "string") {
      const message = arg2 as Uint8Array;
      const sig = arg3 as Uint8Array;
      return this.verifyDetached(message, sig);
    }
    const payload = arg1 as Buffer;
    const sig = arg2 as Buffer;
    return this.verifyDetached(new Uint8Array(payload), new Uint8Array(sig));
  }

  async getPublicKey(_kid?: string): Promise<Uint8Array> {
    return this.publicKeyRaw;
  }

  async sign(_kid: string, message: Uint8Array): Promise<Uint8Array> {
    if (this.privateKey) {
      const sig = cryptoSign(null, Buffer.from(message), this.privateKey);
      return new Uint8Array(sig);
    }
    if (this.secretKey) {
      return nacl.sign.detached(message, this.secretKey);
    }
    throw new Error("LocalKeyProvider: signing key not configured");
  }

  private async verifyDetached(message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    if (this.privateKey) {
      return cryptoVerify(null, Buffer.from(message), this.publicKey, Buffer.from(signature));
    }
    if (this.secretKey) {
      return nacl.sign.detached.verify(message, signature, this.publicKeyRaw);
    }
    return cryptoVerify(null, Buffer.from(message), this.publicKey, Buffer.from(signature));
  }
}

function loadSigningMaterial(): { privateKey?: KeyObject; secretKey?: Uint8Array } {
  const pem = process.env.ED25519_PRIVATE_KEY_PEM || process.env.RPT_ED25519_PRIVATE_KEY_PEM;
  if (pem) {
    return { privateKey: createPrivateKey(pem) };
  }

  const raw = process.env.RPT_ED25519_SECRET_BASE64 || process.env.ED25519_PRIV_RAW_BASE64;
  if (!raw) return {};

  const buf = Buffer.from(raw, "base64");
  if (buf.length === 64) {
    return { secretKey: new Uint8Array(buf) };
  }
  if (buf.length === 32) {
    const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(buf));
    return { secretKey: kp.secretKey };
  }
  throw new Error(`RPT_ED25519_SECRET_BASE64 must be 32-byte seed or 64-byte secret; got ${buf.length} bytes`);
}

function loadPublicKey(): { keyObject: KeyObject; rawKey: Uint8Array } {
  const pem = process.env.ED25519_PUBLIC_KEY_PEM || process.env.RPT_PUBLIC_KEY_PEM;
  const raw64 = process.env.ED25519_PUBLIC_KEY_BASE64 || process.env.RPT_PUBLIC_BASE64;

  if (pem) {
    const key = createPublicKey(pem);
    const der = key.export({ format: "der", type: "spki" }) as Buffer;
    const rawKey = new Uint8Array(der.slice(-32));
    return { keyObject: key, rawKey };
  }

  if (raw64) {
    const raw = Buffer.from(raw64, "base64");
    if (raw.length !== 32) {
      throw new Error(`RPT_PUBLIC_BASE64 must be 32 bytes (got ${raw.length})`);
    }
    const key = createPublicKey(pemFromSpki(spkiFromRawEd25519(raw)));
    return { keyObject: key, rawKey: new Uint8Array(raw) };
  }

  throw new Error("No public key found. Set ED25519_PUBLIC_KEY_PEM or RPT_PUBLIC_BASE64 in .env.local");
}

/** Build a PEM SPKI from a raw 32-byte Ed25519 public key (OID 1.3.101.112). */
function spkiFromRawEd25519(raw: Buffer): Buffer {
  const prefix = Buffer.from([
    0x30, 0x2a,             // SEQUENCE, len 42
    0x30, 0x05,             // SEQUENCE, len 5
    0x06, 0x03, 0x2b, 0x65, 0x70, // OID 1.3.101.112
    0x03, 0x21, 0x00        // BIT STRING (33): 0x00 + 32 key bytes
  ]);
  return Buffer.concat([prefix, raw]);
}

function pemFromSpki(spki: Buffer): string {
  const b64 = spki.toString("base64").match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
}
