import { v4 as uuidv4 } from "uuid";
import { BankDestination, BankEgressProvider, BankProviderError, BankRail, BankReleaseResult } from "@core/ports";

function destinationKey(abn: string, rail: BankRail, reference: string) {
  return `${abn}:${rail}:${reference}`;
}

export interface MockBankProviderOptions {
  destinations?: BankDestination[];
}

export function createMockBankProvider(options: MockBankProviderOptions = {}): BankEgressProvider {
  const destinations = new Map<string, BankDestination>();
  for (const dest of options.destinations || []) {
    destinations.set(destinationKey(dest.abn, dest.rail, dest.reference), dest);
  }
  const idempotencyKeys = new Set<string>();

  return {
    async resolveDestination(abn, rail, reference) {
      const dest = destinations.get(destinationKey(abn, rail, reference));
      if (!dest) {
        throw new BankProviderError("DEST_NOT_ALLOW_LISTED");
      }
      return dest;
    },
    async releasePayment(abn, taxType, periodId, amountCents, rail, reference) {
      if (amountCents <= 0) {
        throw new BankProviderError("AMOUNT_MUST_BE_POSITIVE");
      }
      const key = `${abn}:${taxType}:${periodId}:${amountCents}:${rail}:${reference}`;
      if (idempotencyKeys.has(key)) {
        const transfer_uuid = uuidv4();
        return { transfer_uuid, bank_receipt_hash: `bank:${transfer_uuid.slice(0, 12)}`, status: "DUPLICATE" };
      }
      idempotencyKeys.add(key);
      const transfer_uuid = uuidv4();
      const bank_receipt_hash = `bank:${transfer_uuid.slice(0, 12)}`;
      return { transfer_uuid, bank_receipt_hash, status: "OK" } satisfies BankReleaseResult;
    },
  } satisfies BankEgressProvider;
}
