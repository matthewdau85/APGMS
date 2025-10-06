import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export type SecretBackend = "local" | "aws";

export interface SecretEnvelope {
  backend: SecretBackend;
  ciphertext: string;
  iv?: string;
  tag?: string;
  kmsKeyId?: string;
}

function getBackend(): SecretBackend {
  const backend = (process.env.MFA_VAULT_BACKEND || "local").toLowerCase();
  return backend === "aws" ? "aws" : "local";
}

function getLocalKey(): Buffer {
  const secret = process.env.MFA_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("MFA_ENCRYPTION_KEY must be set for local MFA secret encryption");
  }
  const buf = Buffer.from(secret, "base64");
  if (buf.length !== 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes base64 encoded");
  }
  return buf;
}

let kmsClient: any = null;
let kmsModule: any = null;

async function loadKms() {
  if (!kmsModule) {
    try {
      kmsModule = await import("@aws-sdk/client-kms");
    } catch (err) {
      throw new Error(
        "AWS KMS backend requested but @aws-sdk/client-kms is not installed. Add it to dependencies to enable this backend."
      );
    }
  }
  if (!kmsClient) {
    kmsClient = new kmsModule.KMSClient({ region: process.env.MFA_KMS_REGION || process.env.AWS_REGION || "us-east-1" });
  }
  return {
    client: kmsClient,
    EncryptCommand: kmsModule.EncryptCommand,
    DecryptCommand: kmsModule.DecryptCommand,
  };
}

export async function encryptSecret(plaintext: string): Promise<SecretEnvelope> {
  const backend = getBackend();
  if (backend === "aws") {
    const keyId = process.env.MFA_KMS_KEY_ID;
    if (!keyId) {
      throw new Error("MFA_KMS_KEY_ID is required when using aws vault backend");
    }
    const { client, EncryptCommand } = await loadKms();
    const result = await client.send(new EncryptCommand({ KeyId: keyId, Plaintext: Buffer.from(plaintext, "utf8") }));
    if (!result.CiphertextBlob) {
      throw new Error("KMS encryption failed");
    }
    return {
      backend,
      ciphertext: Buffer.from(result.CiphertextBlob).toString("base64"),
      kmsKeyId: keyId,
    };
  }

  const key = getLocalKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    backend,
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export async function decryptSecret(envelope: SecretEnvelope): Promise<string> {
  if (envelope.backend === "aws") {
    const { client, DecryptCommand } = await loadKms();
    const result = await client.send(
      new DecryptCommand({ CiphertextBlob: Buffer.from(envelope.ciphertext, "base64"), KeyId: envelope.kmsKeyId })
    );
    if (!result.Plaintext) {
      throw new Error("KMS decryption failed");
    }
    return Buffer.from(result.Plaintext).toString("utf8");
  }

  const key = getLocalKey();
  const iv = envelope.iv ? Buffer.from(envelope.iv, "base64") : null;
  const tag = envelope.tag ? Buffer.from(envelope.tag, "base64") : null;
  if (!iv || !tag) {
    throw new Error("Local envelope missing IV or tag");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
