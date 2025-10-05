import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface KeyMaterial {
  key: Uint8Array;
  keyId: string;
  source: "env" | "file";
}

let cachedKey: KeyMaterial | undefined;

function dataKey(): Buffer {
  const raw = process.env.KMS_DATA_KEY_HEX || process.env.RPT_DATA_KEY_HEX;
  if (!raw) {
    throw new Error("Missing data key. Set KMS_DATA_KEY_HEX env");
  }
  const buf = Buffer.from(raw, "hex");
  if (![16, 24, 32].includes(buf.length)) {
    throw new Error(`KMS_DATA_KEY_HEX must be 16/24/32 bytes, got ${buf.length}`);
  }
  return buf;
}

function decryptEnvelope(filePath: string): KeyMaterial {
  const absolutePath = path.resolve(filePath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const payload = JSON.parse(raw) as {
    keyId: string;
    iv: string;
    authTag: string;
    ciphertext: string;
  };
  const key = dataKey();
  const iv = Buffer.from(payload.iv, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const tag = Buffer.from(payload.authTag, "base64");
  const decipher = crypto.createDecipheriv(`aes-${key.length * 8}-gcm`, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return {
    key: new Uint8Array(decrypted),
    keyId: payload.keyId,
    source: "file",
  };
}

function fromEnv(): KeyMaterial {
  const raw = process.env.RPT_ED25519_SECRET_BASE64;
  if (!raw) {
    throw new Error("Set RPT_ED25519_SECRET_BASE64 or RPT_ED25519_SECRET_ENC_PATH");
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 64) {
    throw new Error("RPT_ED25519_SECRET_BASE64 must decode to 64 bytes");
  }
  return {
    key: new Uint8Array(decoded),
    keyId: "env-local", // fallback identifier
    source: "env",
  };
}

export function loadRptSigningKey(): KeyMaterial {
  if (cachedKey) return cachedKey;
  const encryptedPath = process.env.RPT_ED25519_SECRET_ENC_PATH;
  cachedKey = encryptedPath ? decryptEnvelope(encryptedPath) : fromEnv();
  return cachedKey;
}
