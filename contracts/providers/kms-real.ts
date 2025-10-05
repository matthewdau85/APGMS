import { createHash } from "node:crypto";
import type { KmsPort } from "../interfaces";
import { makeError } from "./shared";

export async function createProvider(): Promise<KmsPort> {
  const keyId = "real-kms-key";
  return {
    keyId,
    timeoutMs: 2000,
    retriableCodes: ["KMS_THROTTLED", "KMS_UNAVAILABLE"],
    async sign(payload: Uint8Array) {
      const digest = createHash("sha256").update(payload).digest();
      return new Uint8Array(digest);
    },
    async verify(payload: Uint8Array, signature: Uint8Array) {
      const digest = createHash("sha256").update(payload).digest();
      return Buffer.compare(Buffer.from(signature), digest) === 0;
    },
    async simulateError(kind) {
      switch (kind) {
        case "bad_key":
          return makeError("KMS_BAD_KEY", "Unknown key", false, 404);
        case "timeout":
        default:
          return makeError("KMS_TIMEOUT", "KMS request timed out", true, 504);
      }
    },
  };
}

export default createProvider;
