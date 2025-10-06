import type { StatementsPort } from "../interfaces";
import { makeError, makeIdempotencyKey } from "./shared";

const sampleStatement = {
  statementId: "BAS-2024-Q4",
  abn: "12345678901",
  period: "2024-Q4",
  amountCents: 1250000,
};

export async function createProvider(): Promise<StatementsPort> {
  const acknowledgements = new Map<string, string>();
  return {
    timeoutMs: 3000,
    retriableCodes: ["STATEMENTS_TEMPORARY"],
    async fetchLatest(abn: string) {
      if (abn !== sampleStatement.abn) {
        throw makeError("STATEMENT_NOT_FOUND", "No statements for ABN", false, 404);
      }
      return sampleStatement;
    },
    async acknowledge(statementId: string) {
      const ackId = acknowledgements.get(statementId) ?? `mock-ack-${statementId}`;
      acknowledgements.set(statementId, ackId);
      return { acknowledged: true, ackId };
    },
    async simulateError(kind) {
      switch (kind) {
        case "timeout":
          return makeError("STATEMENT_TIMEOUT", "Statement service timeout", true, 504);
        case "not_found":
        default:
          return makeError("STATEMENT_NOT_FOUND", "Statement not found", false, 404);
      }
    },
    idempotencyKey(statementId: string) {
      return makeIdempotencyKey([statementId]);
    },
  };
}

export default createProvider;
