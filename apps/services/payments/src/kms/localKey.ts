import '../loadEnv.js';
import fs from 'node:fs';
import { createDecipheriv, createPublicKey, KeyObject, verify as cryptoVerify } from 'node:crypto';
import type { IKms } from './IKms';

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

function decryptEnvelope(): Buffer | undefined {
  const path = process.env.ED25519_PUBLIC_KEY_ENC_PATH || process.env.RPT_PUBLIC_KEY_ENC_PATH;
  if (!path) return undefined;
  const raw = fs.readFileSync(path, 'utf8');
  const payload = JSON.parse(raw) as { iv: string; authTag: string; ciphertext: string };
  const keyHex = process.env.KMS_DATA_KEY_HEX;
  if (!keyHex) throw new Error('Set KMS_DATA_KEY_HEX when using encrypted public keys');
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv(`aes-${key.length * 8}-gcm`, key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]);
}

function loadPublicKey(): KeyObject {
  const pem   = process.env.ED25519_PUBLIC_KEY_PEM || process.env.RPT_PUBLIC_KEY_PEM;
  const raw64 = process.env.ED25519_PUBLIC_KEY_BASE64 || process.env.RPT_PUBLIC_BASE64;
  const decrypted = decryptEnvelope();

  if (pem) return createPublicKey(pem);

  if (raw64) {
    const raw = Buffer.from(raw64, 'base64');
    if (raw.length !== 32) throw new Error(`RPT_PUBLIC_BASE64 must be 32 bytes (got ${raw.length})`);
    const spki = spkiFromRawEd25519(raw);
    return createPublicKey(pemFromSpki(spki));
  }

  if (decrypted) {
    if (decrypted.length === 32) {
      const spki = spkiFromRawEd25519(decrypted);
      return createPublicKey(pemFromSpki(spki));
    }
    return createPublicKey(decrypted);
  }

  throw new Error('No public key found. Set ED25519_PUBLIC_KEY_PEM or RPT_PUBLIC_BASE64 in .env.local');
}

export class LocalKeyProvider implements IKms {
  private key: KeyObject;
  constructor() { this.key = loadPublicKey(); }

  async verify(payload: Buffer, signature: Buffer): Promise<boolean> {
    // Ed25519 => pass null algorithm and raw payload
    return cryptoVerify(null, payload, this.key, signature);
  }
}
