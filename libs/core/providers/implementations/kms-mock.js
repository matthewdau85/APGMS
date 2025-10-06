import nacl from 'tweetnacl';

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function textEncoder(data) {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data;
}

export class MockKms {
  constructor() {
    this.rotate();
  }

  rotate() {
    const seed = process.env.MOCK_KMS_SEED
      ? Buffer.from(process.env.MOCK_KMS_SEED, 'base64')
      : nacl.randomBytes(32);
    const keyPair = nacl.sign.keyPair.fromSeed(seed);
    this.privateKey = keyPair.secretKey;
    this.publicKey = keyPair.publicKey;
    this.kid = process.env.MOCK_KMS_KID || `mock-kms-${base64url(seed).slice(0, 8)}`;
  }

  async signJWS(payload) {
    const body = typeof payload === 'string' || payload instanceof Buffer
      ? Buffer.from(payload)
      : Buffer.from(JSON.stringify(payload));
    const headerB64 = base64url(JSON.stringify({ alg: 'EdDSA', kid: this.kid }));
    const payloadB64 = base64url(body);
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = nacl.sign.detached(new TextEncoder().encode(signingInput), this.privateKey);
    return `${signingInput}.${base64url(signature)}`;
  }

  async jwks() {
    return {
      keys: [
        {
          kty: 'OKP',
          crv: 'Ed25519',
          kid: this.kid,
          x: base64url(this.publicKey),
          use: 'sig',
        },
      ],
    };
  }

  async verify(payload, signature) {
    const payloadBytes = textEncoder(payload instanceof Buffer ? payload : String(payload));
    const signatureBytes = signature instanceof Buffer ? signature : Buffer.from(String(signature), 'base64');
    return nacl.sign.detached.verify(payloadBytes, new Uint8Array(signatureBytes), this.publicKey);
  }
}
