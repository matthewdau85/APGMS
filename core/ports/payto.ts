import { getRuntimeMode, RuntimeMode } from "../runtime/mode";
import type { PayToPort } from "./types/payto";
import { createMockPayTo } from "@providers/payto/mock";
import { createShadowPayTo } from "@providers/payto/shadow";
import { createRealPayTo } from "@providers/payto/real";

const FACTORIES: Record<RuntimeMode, () => PayToPort> = {
  mock: createMockPayTo,
  shadow: createShadowPayTo,
  real: createRealPayTo,
};

export type { PayToPort, PayToMandate, PayToOperationResult, PayToDebitResult } from "./types/payto";

export function createPayToPort(mode: RuntimeMode = getRuntimeMode()): PayToPort {
  return FACTORIES[mode]();
}

export function getPayToImplementations(): Record<RuntimeMode, () => PayToPort> {
  return { ...FACTORIES };
}
