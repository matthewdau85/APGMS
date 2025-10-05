import { KMSClient, GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function requireFlag() {
  const flag = process.env.KMS_REAL_ENABLED;
  if (!flag || !['1', 'true', 'yes'].includes(flag.toLowerCase())) {
    throw new Error('Real KMS provider disabled. Set KMS_REAL_ENABLED=true to enable.');
  }
}

function textToBuffer(payload) {
  if (payload instanceof Buffer) return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  if (typeof payload === 'string') return Buffer.from(payload);
  return Buffer.from(JSON.stringify(payload));
}

export class RealKms {
  constructor() {
    this.keyId = process.env.KMS_KEY_ID;
    if (!this.keyId) {
      throw new Error('Set KMS_KEY_ID to use the real KMS provider');
    }
    this.client = new KMSClient({ region: process.env.AWS_REGION || 'ap-southeast-2' });
    this.publicKey = null;
    this.publicKeyRaw = null;
  }

  async rotate() {
    requireFlag();
    this.publicKey = null;
    this.publicKeyRaw = null;
  }

  async loadPublicKey() {
    if (this.publicKey && this.publicKeyRaw) {
      return;
    }
    requireFlag();
    const out = await this.client.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    if (!out.PublicKey) {
      throw new Error('KMS did not return a public key');
    }
    const der = Buffer.from(out.PublicKey);
    this.publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
    this.publicKeyRaw = der.slice(-32); // Ed25519 public key is last 32 bytes
  }

  async signJWS(payload) {
    await this.loadPublicKey();
    const body = textToBuffer(payload);
    const headerB64 = base64url(JSON.stringify({ alg: 'EdDSA', kid: this.keyId }));
    const payloadB64 = base64url(body);
    const signingInput = `${headerB64}.${payloadB64}`;
    const command = new SignCommand({
      KeyId: this.keyId,
      SigningAlgorithm: 'EDDSA',
      MessageType: 'RAW',
      Message: Buffer.from(signingInput),
    });
    const out = await this.client.send(command);
    if (!out.Signature) {
      throw new Error('KMS did not return a signature');
    }
    return `${signingInput}.${base64url(out.Signature)}`;
  }

  async jwks() {
    await this.loadPublicKey();
    return {
      keys: [
        {
          kty: 'OKP',
          crv: 'Ed25519',
          kid: this.keyId,
          x: base64url(this.publicKeyRaw),
          use: 'sig',
        },
      ],
    };
  }

  async verify(payload, signature) {
    await this.loadPublicKey();
    const payloadBuffer = textToBuffer(payload);
    const sigBuffer = signature instanceof Buffer ? signature : Buffer.from(signature, 'base64');
    return cryptoVerify(null, payloadBuffer, this.publicKey, sigBuffer);
  }
}
