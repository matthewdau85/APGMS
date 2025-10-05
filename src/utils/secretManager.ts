import crypto from "node:crypto";

const SECRET_CACHE = new Map<string, string>();
const MASTER_KEY_ENV = "KMS_MASTER_KEY";
const ENCRYPTED_SUFFIX = "_ENCRYPTED";

class SecretManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretManagerError";
  }
}

function requireMasterKey(): Buffer {
  const masterKey = process.env[MASTER_KEY_ENV];
  if (!masterKey) {
    throw new SecretManagerError(
      `Missing master key. Set ${MASTER_KEY_ENV} to a base64 encoded AES-256 key.`,
    );
  }

  const key = Buffer.from(masterKey, "base64");
  if (key.length !== 32) {
    throw new SecretManagerError(
      `${MASTER_KEY_ENV} must decode to a 32 byte key. Got ${key.length} bytes.`,
    );
  }

  return key;
}

function decrypt(encryptedValue: string): string {
  const parts = encryptedValue.split(".");
  if (parts.length !== 3) {
    throw new SecretManagerError("Encrypted secret must be iv.ciphertext.tag in base64 format.");
  }

  const [ivB64, ciphertextB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");

  const key = requireMasterKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );

  return decrypted;
}

export function getSecret(name: string): string {
  const cached = SECRET_CACHE.get(name);
  if (cached) {
    return cached;
  }

  const encryptedVar = process.env[`${name}${ENCRYPTED_SUFFIX}`];
  const plainVar = process.env[name];

  if (encryptedVar) {
    const decrypted = decrypt(encryptedVar);
    SECRET_CACHE.set(name, decrypted);
    return decrypted;
  }

  if (plainVar) {
    SECRET_CACHE.set(name, plainVar);
    return plainVar;
  }

  throw new SecretManagerError(`Missing secret for ${name}. Provide ${name}${ENCRYPTED_SUFFIX} or ${name}.`);
}

export function clearSecretCache(): void {
  SECRET_CACHE.clear();
}

export function __encryptForTests(value: string, masterKeyB64: string): string {
  const masterKey = Buffer.from(masterKeyB64, "base64");
  if (masterKey.length !== 32) {
    throw new SecretManagerError("Test master key must decode to 32 bytes.");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}.${ciphertext.toString("base64")}.${authTag.toString("base64")}`;
}

