import { getRuntimeMode, RuntimeMode } from "../runtime/mode";
import type { KmsPort } from "./types/kms";
import { createMockKms } from "@providers/kms/mock";
import { createShadowKms } from "@providers/kms/shadow";
import { createRealKms } from "@providers/kms/real";

const FACTORIES: Record<RuntimeMode, () => KmsPort> = {
  mock: createMockKms,
  shadow: createShadowKms,
  real: createRealKms,
};

export type { KmsPort } from "./types/kms";
export type { VerificationResult } from "./types/kms";

export function createKmsPort(mode: RuntimeMode = getRuntimeMode()): KmsPort {
  return FACTORIES[mode]();
}

export function getKmsImplementations(): Record<RuntimeMode, () => KmsPort> {
  return { ...FACTORIES };
}
