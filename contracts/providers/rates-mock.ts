import type { RatesPort } from "../interfaces";
import { makeError, makeIdempotencyKey } from "./shared";

const baseBrackets = [
  { threshold: 0, rate: 0.1 },
  { threshold: 1800000, rate: 0.2 },
  { threshold: 4500000, rate: 0.3 },
];

export async function createProvider(): Promise<RatesPort> {
  return {
    timeoutMs: 1500,
    retriableCodes: ["RATES_UNAVAILABLE"],
    async fetchRates(input) {
      if (input.region !== "AU") {
        throw makeError("RATES_NOT_FOUND", `Region ${input.region} unsupported`, false, 404);
      }
      return {
        version: `mock-${input.taxYear}`,
        brackets: baseBrackets,
      };
    },
    async simulateError(kind) {
      switch (kind) {
        case "timeout":
          return makeError("RATES_TIMEOUT", "Tax rate service timeout", true, 504);
        case "not_found":
        default:
          return makeError("RATES_NOT_FOUND", "Rate table missing", false, 404);
      }
    },
    idempotencyKey(input) {
      return makeIdempotencyKey([input.region, input.taxYear]);
    },
  };
}

export default createProvider;
