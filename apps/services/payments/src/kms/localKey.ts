import '../loadEnv.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IKms } from './IKms';

type KeySet = Map<string, Buffer>;

function decodeSecret(raw: string): Buffer {
  if (raw.startsWith('base64:')) {
    return Buffer.from(raw.slice('base64:'.length), 'base64');
  }
  if (raw.startsWith('hex:')) {
    return Buffer.from(raw.slice('hex:'.length), 'hex');
  }
  try {
    return Buffer.from(raw, 'base64');
  } catch (err) {
    return Buffer.from(raw, 'utf8');
  }
}

function loadKeySet(): KeySet {
  const keys = new Map<string, Buffer>();
  const json = process.env.APGMS_RPT_LOCAL_KEYS || process.env.RPT_LOCAL_KEYS;
  if (json) {
    try {
      const parsed = JSON.parse(json) as Record<string, string>;
      for (const [kid, secret] of Object.entries(parsed)) {
        keys.set(kid, decodeSecret(secret));
      }
    } catch (err) {
      throw new Error('Failed to parse APGMS_RPT_LOCAL_KEYS');
    }
  }

  const activeKid = process.env.APGMS_RPT_ACTIVE_KID || process.env.RPT_ACTIVE_KID || 'local-dev';
  const fallback = process.env.APGMS_RPT_SECRET || process.env.RPT_SHARED_SECRET || 'dev-secret-change-me';
  if (!keys.has(activeKid)) {
    keys.set(activeKid, Buffer.from(fallback, 'utf8'));
  }

  const trusted = process.env.APGMS_RPT_TRUSTED_KIDS || process.env.RPT_TRUSTED_KIDS;
  if (trusted) {
    for (const kid of trusted.split(',').map((k) => k.trim()).filter(Boolean)) {
      if (!keys.has(kid) && process.env[`APGMS_RPT_SECRET_${kid}`]) {
        keys.set(kid, Buffer.from(process.env[`APGMS_RPT_SECRET_${kid}`]!, 'utf8'));
      }
    }
  }

  return keys;
}

function computeHmac(key: Buffer, payload: Buffer): Buffer {
  return createHmac('sha256', key).update(payload).digest();
}

export class LocalKeyProvider implements IKms {
  private readonly keys: KeySet;
  private readonly activeKid: string;

  constructor() {
    this.keys = loadKeySet();
    this.activeKid = process.env.APGMS_RPT_ACTIVE_KID || process.env.RPT_ACTIVE_KID || 'local-dev';
  }

  async verify(payload: Buffer, signature: Buffer, kid?: string): Promise<boolean> {
    const keyId = kid || this.activeKid;
    const candidates: [string, Buffer][] = [];

    const preferred = this.keys.get(keyId);
    if (preferred) {
      candidates.push([keyId, preferred]);
    }

    for (const [candidateKid, secret] of this.keys.entries()) {
      if (candidateKid === keyId) continue;
      candidates.push([candidateKid, secret]);
    }

    for (const [, secret] of candidates) {
      const mac = computeHmac(secret, payload);
      if (mac.length === signature.length && timingSafeEqual(mac, signature)) {
        return true;
      }
    }

    return false;
  }
}
