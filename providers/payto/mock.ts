import { randomUUID } from "node:crypto";
import type { PayToPort, PayToOperationResult, PayToDebitResult, PayToMandate } from "@core/ports/types/payto";

interface MandateRecord extends PayToMandate {
  ledger: number;
}

export function createMockPayTo(): PayToPort {
  const mandates = new Map<string, MandateRecord>();

  function result(mandate: MandateRecord | undefined, ok: boolean, code?: string): PayToOperationResult {
    return {
      ok,
      code,
      mandate: mandate ? { ...mandate } : undefined,
    };
  }

  return {
    async createMandate({ abn, periodId, capCents }) {
      const id = randomUUID();
      const record: MandateRecord = { id, abn, periodId, capCents, status: "PENDING", ledger: 0 };
      mandates.set(id, record);
      return result(record, true);
    },

    async verifyMandate(mandateId) {
      const record = mandates.get(mandateId);
      if (!record) return result(undefined, false, "NOT_FOUND");
      if (record.status === "CANCELLED") return result(record, false, "MANDATE_CANCELLED");
      record.status = "VERIFIED";
      return result(record, true);
    },

    async debitMandate(mandateId, amountCents, _metadata) {
      const record = mandates.get(mandateId);
      if (!record) return { ok: false, code: "NOT_FOUND" } satisfies PayToDebitResult;
      if (record.status === "CANCELLED") return { ok: false, code: "MANDATE_CANCELLED" };
      if (amountCents <= 0) return { ok: false, code: "INVALID_AMOUNT" };
      if (amountCents > record.capCents) return { ok: false, code: "CAP_EXCEEDED" };
      record.ledger += amountCents;
      return {
        ok: true,
        bankRef: `mock-${mandateId.slice(0, 8)}-${record.ledger}`,
      } satisfies PayToDebitResult;
    },

    async cancelMandate(mandateId) {
      const record = mandates.get(mandateId);
      if (!record) return result(undefined, false, "NOT_FOUND");
      record.status = "CANCELLED";
      return result(record, true);
    },
  } satisfies PayToPort;
}
