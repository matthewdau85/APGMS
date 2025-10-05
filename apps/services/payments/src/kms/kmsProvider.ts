// apps/services/payments/src/kms/kmsProvider.ts
// Legacy compatibility shim: new code should import from @core/ports/kms directly.
import { createKmsPort } from "@core/ports/kms";
import type { KmsPort } from "@core/ports/kms";

export type KmsProvider = KmsPort;

export async function getKms(): Promise<KmsPort> {
  return createKmsPort();
}

export function selectKms(): KmsPort {
  return createKmsPort();
}
