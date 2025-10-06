import { KmsProvider, KmsSigningMaterial, KmsPublicKey } from "./kms";

function decodeBase64(value: string, label: string): Uint8Array {
  try {
    return new Uint8Array(Buffer.from(value, "base64"));
  } catch {
    throw new Error(`${label}_INVALID_BASE64`);
  }
}

export class LocalEd25519Provider implements KmsProvider {
  private readonly kid: string;
  private readonly ratesVersion: string;
  private readonly secretKey: Uint8Array;
  private readonly publicKey: Uint8Array;

  constructor() {
    const secret = process.env.RPT_ED25519_SECRET_BASE64 || "";
    const pub = process.env.RPT_ED25519_PUBLIC_BASE64 || "";
    if (!secret) throw new Error("RPT_ED25519_SECRET_BASE64 not configured");
    if (!pub) throw new Error("RPT_ED25519_PUBLIC_BASE64 not configured");
    this.secretKey = decodeBase64(secret, "RPT_ED25519_SECRET_BASE64");
    this.publicKey = decodeBase64(pub, "RPT_ED25519_PUBLIC_BASE64");
    this.kid = process.env.RPT_KID || "local-ed25519";
    this.ratesVersion = process.env.RATES_VERSION || "v0";
  }

  async getSigningMaterial(): Promise<KmsSigningMaterial> {
    return {
      kid: this.kid,
      ratesVersion: this.ratesVersion,
      secretKey: this.secretKey,
    };
  }

  async listPublicKeys(): Promise<KmsPublicKey[]> {
    return [
      {
        kid: this.kid,
        ratesVersion: this.ratesVersion,
        publicKey: this.publicKey,
      },
    ];
  }
}
