import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  iv: string;
  data: string;
  tag: string;
}

function getKey(): Buffer {
  const key = process.env.MFA_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("MFA_ENCRYPTION_KEY not configured");
  }
  const buffer = Buffer.from(key, "base64");
  if (buffer.length !== 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes base64 encoded");
  }
  return buffer;
}

export function encryptSecret(secret: string): EncryptedSecret {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    data: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(payload: EncryptedSecret): string {
  const key = getKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
