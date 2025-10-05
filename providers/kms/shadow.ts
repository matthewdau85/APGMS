import type { KmsPort, VerificationResult } from "@core/ports/types/kms";
import { createMockKms } from "./mock";
import { createRealKms } from "./real";

export function createShadowKms(): KmsPort {
  const real = createRealKms();
  const mock = createMockKms();

  async function verify(payload: Uint8Array, signature: Uint8Array, options?: { keyId?: string }): Promise<VerificationResult> {
    const [realResult, mockResult] = await Promise.all([
      real.verify(payload, signature, options),
      mock.verify(payload, signature, options),
    ]);

    if (realResult.ok !== mockResult.ok) {
      console.warn("[kms-shadow] divergence detected", { realResult, mockResult });
    }
    return realResult;
  }

  return { verify };
}
