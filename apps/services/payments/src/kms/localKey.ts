import '../loadEnv.js';
import { createPublicKey, KeyObject, verify as cryptoVerify } from 'node:crypto';
import nacl from 'tweetnacl';
import type { IKms } from './IKms';

const DEV_SECRET_BASE64 = 'RALIpN6tiUu7C5wn2e8YEb5/NwPt0nUMHy1qlEBHlymb5ZDNAELVEMNFcUIUOZGFGalDe6PAnpgJfR5PEe2F3w==';

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
  const b64 = spki.toString('base64').match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
}

function derivePublicFromSecret(base64: string): Buffer {
  const secret = Buffer.from(base64, 'base64');
  if (secret.length !== 64) throw new Error(`RPT_ED25519_SECRET_BASE64 must be 64 bytes (got ${secret.length})`);
  const kp = nacl.sign.keyPair.fromSecretKey(new Uint8Array(secret));
  return Buffer.from(kp.publicKey);
}

function loadPublicKey(): KeyObject {
  const pem   = process.env.ED25519_PUBLIC_KEY_PEM || process.env.RPT_PUBLIC_KEY_PEM;
  const raw64 = process.env.ED25519_PUBLIC_KEY_BASE64 || process.env.RPT_PUBLIC_BASE64;

  if (pem) return createPublicKey(pem);

  if (raw64) {
    const raw = Buffer.from(raw64, 'base64');
    if (raw.length !== 32) throw new Error(`RPT_PUBLIC_BASE64 must be 32 bytes (got ${raw.length})`);
    const spki = spkiFromRawEd25519(raw);
    return createPublicKey(pemFromSpki(spki));
  }

  const secretBase64 = process.env.RPT_ED25519_SECRET_BASE64 || DEV_SECRET_BASE64;
  const derived = derivePublicFromSecret(secretBase64);
  const spki = spkiFromRawEd25519(derived);
  return createPublicKey(pemFromSpki(spki));
}

export class LocalKeyProvider implements IKms {
  private key: KeyObject;
  constructor() { this.key = loadPublicKey(); }

  async verify(payload: Buffer, signature: Buffer): Promise<boolean> {
    // Ed25519 => pass null algorithm and raw payload
    return cryptoVerify(null, payload, this.key, signature);
  }
}
