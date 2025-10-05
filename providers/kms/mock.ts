import * as ed from "tweetnacl";
import type { KmsPort, VerificationResult } from "@core/ports/types/kms";
import { loadEd25519RawPublicKey, SIGNATURE_INVALID_CODE } from "./common";

export function createMockKms(): KmsPort {
  const publicKey = new Uint8Array(loadEd25519RawPublicKey());

  async function verify(payload: Uint8Array, signature: Uint8Array): Promise<VerificationResult> {
    const ok = ed.sign.detached.verify(payload, signature, publicKey);
    if (!ok) {
      return { ok: false, code: SIGNATURE_INVALID_CODE };
    }
    return { ok: true };
  }

  return {
    verify,
  };
}
