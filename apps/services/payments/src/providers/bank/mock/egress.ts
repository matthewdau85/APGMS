import { randomUUID } from "node:crypto";
import { DeadLetterQueue } from "../shared/dlq.js";
import { executeWithRetry } from "../shared/retry.js";
import type { BankEgressPort, PayoutRequest, PayoutResult } from "../port.js";

const dlq = new DeadLetterQueue({ prefix: "mock-bank-egress" });

export class MockBankEgress implements BankEgressPort {
  async submitPayout(request: PayoutRequest): Promise<PayoutResult> {
    try {
      return await executeWithRetry(async () => {
        const bank_txn_id = randomUUID();
        return {
          status: "ACCEPTED",
          provider_code: "MOCK-ACCEPT",
          reference: request.reference,
          bank_txn_id,
          raw: {
            release_uuid: request.metadata?.release_uuid,
            attempt: "mock",
          },
        } satisfies PayoutResult;
      });
    } catch (error: any) {
      await dlq.push({
        provider: "mock",
        request,
        error: String(error?.message ?? error),
      });
      throw error;
    }
  }
}
