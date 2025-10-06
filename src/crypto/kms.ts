export interface KmsSigner {
  sign(payload: Uint8Array): Promise<Uint8Array>;
  getPublicKeyPEM(): Promise<string>;
}

export interface AwsKmsEd25519Options {
  keyId: string;
  region?: string;
  client?: any;
}

type AwsSdkModule = {
  KMSClient: new (config?: Record<string, any>) => any;
  SignCommand: new (input: Record<string, any>) => any;
  GetPublicKeyCommand: new (input: Record<string, any>) => any;
};

let kmsModulePromise: Promise<AwsSdkModule> | null = null;

async function loadAwsSdk(): Promise<AwsSdkModule> {
  if (!kmsModulePromise) {
    kmsModulePromise = import("@aws-sdk/client-kms").catch((err) => {
      throw new Error(
        "@aws-sdk/client-kms is required to use AwsKmsEd25519. Install the package in production environments.");
    });
  }
  return kmsModulePromise;
}

function toPem(der: Uint8Array): string {
  const body = Buffer.from(der).toString("base64");
  const chunks = body.match(/.{1,64}/g) ?? [];
  const joined = chunks.join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${joined}\n-----END PUBLIC KEY-----`;
}

export class AwsKmsEd25519 implements KmsSigner {
  private readonly clientPromise: Promise<any>;
  private readonly keyId: string;
  private SignCommandCtor?: any;
  private GetPublicKeyCommandCtor?: any;
  private cachedPem?: string;

  constructor(options: AwsKmsEd25519Options) {
    this.keyId = options.keyId;
    this.clientPromise = (async () => {
      const mod = await loadAwsSdk();
      this.SignCommandCtor = mod.SignCommand;
      this.GetPublicKeyCommandCtor = mod.GetPublicKeyCommand;
      if (options.client) {
        return options.client;
      }
      const region = options.region ?? process.env.KMS_REGION ?? process.env.AWS_REGION ?? "ap-southeast-2";
      return new mod.KMSClient({ region });
    })();
  }

  async sign(payload: Uint8Array): Promise<Uint8Array> {
    const client = await this.clientPromise;
    if (!this.SignCommandCtor) throw new Error("AWS SDK SignCommand unavailable");
    const res = await client.send(new this.SignCommandCtor({
      KeyId: this.keyId,
      Message: payload,
      MessageType: "RAW",
      SigningAlgorithm: "EDDSA",
    }));
    if (!res.Signature) {
      throw new Error("AWS KMS did not return a signature");
    }
    const sig = res.Signature instanceof Uint8Array ? res.Signature : new Uint8Array(res.Signature as ArrayBuffer);
    return new Uint8Array(sig);
  }

  async getPublicKeyPEM(): Promise<string> {
    if (this.cachedPem) return this.cachedPem;
    const client = await this.clientPromise;
    if (!this.GetPublicKeyCommandCtor) throw new Error("AWS SDK GetPublicKeyCommand unavailable");
    const res = await client.send(new this.GetPublicKeyCommandCtor({ KeyId: this.keyId }));
    if (!res.PublicKey) {
      throw new Error("AWS KMS did not return a public key");
    }
    const pub = res.PublicKey instanceof Uint8Array ? res.PublicKey : new Uint8Array(res.PublicKey as ArrayBuffer);
    this.cachedPem = toPem(pub);
    return this.cachedPem;
  }

  getKeyId(): string {
    return this.keyId;
  }
}
