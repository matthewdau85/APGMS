import crypto from "crypto";
import nacl from "tweetnacl";
import {
  RptPayload,
  canonicalizeRptPayload,
  encodeRptPayload,
  signDetached,
  verifyDetached,
} from "./ed25519";

export interface KmsProvider {
  sign(message: Uint8Array): Promise<string>;
  verify(message: Uint8Array, signature: string): Promise<boolean>;
}

function getEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

class LocalKmsProvider implements KmsProvider {
  private readonly secretKey: Uint8Array;
  private readonly publicKey?: Uint8Array;

  constructor() {
    const secretB64 = getEnv("RPT_ED25519_SECRET_BASE64");
    if (!secretB64) {
      throw new Error("RPT_ED25519_SECRET_BASE64 is required for local KMS");
    }
    this.secretKey = new Uint8Array(Buffer.from(secretB64, "base64"));

    const publicB64 = getEnv("RPT_ED25519_PUBLIC_BASE64");
    if (publicB64) {
      this.publicKey = new Uint8Array(Buffer.from(publicB64, "base64"));
    } else if (this.secretKey.length === 64) {
      const { publicKey } = nacl.sign.keyPair.fromSecretKey(this.secretKey);
      this.publicKey = publicKey;
    }
  }

  async sign(message: Uint8Array): Promise<string> {
    const sig = signDetached(message, this.secretKey);
    return Buffer.from(sig).toString("base64url");
  }

  async verify(message: Uint8Array, signature: string): Promise<boolean> {
    if (!this.publicKey) {
      throw new Error("RPT_ED25519_PUBLIC_BASE64 is required to verify locally");
    }
    const sig = Buffer.from(signature, "base64url");
    return verifyDetached(message, sig, this.publicKey);
  }
}

class AwsKmsProvider implements KmsProvider {
  private readonly keyId: string;
  private readonly signingAlgorithm: string;
  private clientPromise?: Promise<any>;

  constructor() {
    this.keyId = getEnv("AWS_KMS_KEY_ID");
    if (!this.keyId) {
      throw new Error("AWS_KMS_KEY_ID must be configured when FEATURE_KMS=aws");
    }
    this.signingAlgorithm = getEnv("AWS_KMS_SIGNING_ALGORITHM", "EDDSA");
  }

  private async getModule() {
    try {
      return await import("@aws-sdk/client-kms");
    } catch (err) {
      const error = new Error("@aws-sdk/client-kms is required when FEATURE_KMS=aws");
      (error as any).cause = err;
      throw error;
    }
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = this.getModule().then(({ KMSClient }) => new KMSClient({}));
    }
    return this.clientPromise;
  }

  async sign(message: Uint8Array): Promise<string> {
    const [{ SignCommand }, client] = await Promise.all([
      this.getModule(),
      this.getClient(),
    ]);
    const response = await client.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: message,
        MessageType: "RAW",
        SigningAlgorithm: this.signingAlgorithm,
      }),
    );
    if (!response.Signature) {
      throw new Error("AWS KMS did not return a signature");
    }
    return Buffer.from(response.Signature).toString("base64url");
  }

  async verify(message: Uint8Array, signature: string): Promise<boolean> {
    const [{ VerifyCommand }, client] = await Promise.all([
      this.getModule(),
      this.getClient(),
    ]);
    const response = await client.send(
      new VerifyCommand({
        KeyId: this.keyId,
        Message: message,
        MessageType: "RAW",
        Signature: Buffer.from(signature, "base64url"),
        SigningAlgorithm: this.signingAlgorithm,
      }),
    );
    return Boolean(response.SignatureValid);
  }
}

class GcpKmsProvider implements KmsProvider {
  private readonly keyVersionName: string;
  private clientPromise?: Promise<any>;
  private publicKeyPromise?: Promise<crypto.KeyObject>;

  constructor() {
    this.keyVersionName = getEnv("GCP_KMS_KEY_VERSION_NAME");
    if (!this.keyVersionName) {
      throw new Error("GCP_KMS_KEY_VERSION_NAME must be configured when FEATURE_KMS=gcp");
    }
  }

  private async getModule() {
    try {
      return await import("@google-cloud/kms");
    } catch (err) {
      const error = new Error("@google-cloud/kms is required when FEATURE_KMS=gcp");
      (error as any).cause = err;
      throw error;
    }
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = this.getModule().then(({ KeyManagementServiceClient }) => new KeyManagementServiceClient());
    }
    return this.clientPromise;
  }

  private async getPublicKey(): Promise<crypto.KeyObject> {
    if (!this.publicKeyPromise) {
      this.publicKeyPromise = (async () => {
        const client = await this.getClient();
        const [response] = await client.getPublicKey({ name: this.keyVersionName });
        if (!response?.pem) {
          throw new Error("GCP KMS public key retrieval failed");
        }
        return crypto.createPublicKey(response.pem);
      })();
    }
    return this.publicKeyPromise;
  }

  async sign(message: Uint8Array): Promise<string> {
    const client = await this.getClient();
    const [result] = await client.asymmetricSign({
      name: this.keyVersionName,
      data: Buffer.from(message),
    });
    const signature = result?.signature;
    if (!signature) {
      throw new Error("GCP KMS did not return a signature");
    }
    return Buffer.from(signature).toString("base64url");
  }

  async verify(message: Uint8Array, signature: string): Promise<boolean> {
    const keyObject = await this.getPublicKey();
    return crypto.verify(null, Buffer.from(message), keyObject, Buffer.from(signature, "base64url"));
  }
}

function selectProvider(): KmsProvider {
  const mode = getEnv("FEATURE_KMS", "local").toLowerCase();
  switch (mode) {
    case "aws":
      return new AwsKmsProvider();
    case "gcp":
      return new GcpKmsProvider();
    case "local":
    case "":
    default:
      return new LocalKmsProvider();
  }
}

const provider = selectProvider();

export function getKmsProvider(): KmsProvider {
  return provider;
}

export async function signRpt(payload: RptPayload): Promise<string> {
  return provider.sign(encodeRptPayload(payload));
}

export async function verifyRpt(payload: RptPayload, signature: string): Promise<boolean> {
  return provider.verify(encodeRptPayload(payload), signature);
}

export function getCanonicalPayload(payload: RptPayload): string {
  return canonicalizeRptPayload(payload);
}
