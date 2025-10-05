import { verify as cryptoVerify } from "node:crypto";
import type { KmsPort, VerificationResult } from "@core/ports/types/kms";
import { loadEd25519PublicKeyObject, SIGNATURE_INVALID_CODE } from "./common";

export function createRealKms(): KmsPort {
  const keyObject = loadEd25519PublicKeyObject();

  async function verify(payload: Uint8Array, signature: Uint8Array): Promise<VerificationResult> {
    const ok = cryptoVerify(null, Buffer.from(payload), keyObject, Buffer.from(signature));
    if (!ok) {
      return { ok: false, code: SIGNATURE_INVALID_CODE };
    }
    return { ok: true };
  }

  return { verify };
}
