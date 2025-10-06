import assert from "node:assert/strict";
import type { BankPort, BankTransferRequest } from "./interfaces";
import type { ContractSpec } from "./types";
import { makeReport } from "./types";
import { describeValue } from "./utils";

const spec: ContractSpec = async (ctx) => {
  const provider = await ctx.load<BankPort>();
  const request: BankTransferRequest = {
    abn: "12345678901",
    amountCents: 250000,
    reference: "INV-2024-0001",
  };

  const response = await provider.initiateTransfer(request);
  assert.equal(typeof response.transferId, "string", "transferId should be string");
  assert.ok(response.receipt.reference.length > 0, "receipt.reference required");

  // Idempotency check by invoking again
  const replay = await provider.initiateTransfer(request);
  assert.deepEqual(replay, response, "Idempotent transfer should return same payload");

  const insufficient = await provider.simulateError("insufficient_funds");
  assert.equal(insufficient.code, "INSUFFICIENT_FUNDS");
  assert.equal(insufficient.retriable, false);

  const timeout = await provider.simulateError("timeout");
  assert.equal(timeout.code, "BANK_TIMEOUT");
  assert.equal(timeout.retriable, true);

  assert.ok(provider.timeoutMs > 0, "timeoutMs must be positive");
  const retriableCodes = [...provider.retriableCodes].sort();

  return makeReport(ctx, {
    responseTypes: {
      initiateTransfer: describeValue(response),
    },
    errors: {
      insufficient_funds: insufficient,
      timeout,
    },
    idempotency: {
      initiateTransfer: provider.idempotencyKey(request),
    },
    timeoutMs: provider.timeoutMs,
    retriableCodes,
  });
};

export default spec;
