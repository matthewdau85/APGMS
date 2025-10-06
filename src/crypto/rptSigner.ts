import { env } from "../config/env";
import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from "crypto";

function b64ToBufStrict(b64: string, errorMessage: string) {
  try {
    const normalized = b64.replace(/\s+/g, "");
    const buf = Buffer.from(normalized, "base64");
    if (buf.length === 0) throw new Error();
    const reencoded = buf.toString("base64");
    if (reencoded.replace(/=+$/, "") !== normalized.replace(/=+$/, "")) {
      throw new Error();
    }
    return buf;
  } catch {
    throw new Error(errorMessage);
  }
}

const secret = env.RPT_ED25519_SECRET_BASE64.trim();
if (!secret) throw new Error("RPT_ED25519_SECRET_BASE64 missing");
const privSeed = b64ToBufStrict(secret, "RPT_ED25519_SECRET_BASE64 is not valid base64");
if (privSeed.length !== 32 && privSeed.length !== 64) {
  throw new Error("RPT_ED25519_SECRET_BASE64 must decode to 32 or 64 bytes for an ed25519 seed");
}

// Convert the 32-byte seed into a PKCS#8 ed25519 private key for Node's crypto API.
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const seed = privSeed.slice(0, 32);
const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
const publicKey = createPublicKey(privateKey);

export const rptSigner = {
  async sign(payload: string) {
    const sig = nodeSign(null, Buffer.from(payload), privateKey);
    return sig.toString("base64");
  },
  async verify(payload: string, signatureB64: string) {
    const signature = b64ToBufStrict(signatureB64, "RPT signature is not valid base64");
    return nodeVerify(null, Buffer.from(payload), publicKey, signature);
  },
};
