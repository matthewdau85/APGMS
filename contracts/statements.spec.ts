import assert from "node:assert/strict";
import type { StatementsPort } from "./interfaces";
import type { ContractSpec } from "./types";
import { makeReport } from "./types";
import { describeValue } from "./utils";

const spec: ContractSpec = async (ctx) => {
  const provider = await ctx.load<StatementsPort>();
  const abn = "12345678901";

  const statement = await provider.fetchLatest(abn);
  assert.equal(statement.abn, abn);
  assert.ok(statement.amountCents > 0);

  const ack = await provider.acknowledge(statement.statementId);
  assert.equal(ack.acknowledged, true);
  assert.equal(typeof ack.ackId, "string");

  const notFound = await provider.simulateError("not_found");
  assert.equal(notFound.code, "STATEMENT_NOT_FOUND");
  assert.equal(notFound.retriable, false);

  const timeout = await provider.simulateError("timeout");
  assert.equal(timeout.code, "STATEMENT_TIMEOUT");
  assert.equal(timeout.retriable, true);

  assert.ok(provider.timeoutMs > 0);

  return makeReport(ctx, {
    responseTypes: {
      fetchLatest: describeValue(statement),
      acknowledge: describeValue(ack),
    },
    errors: {
      not_found: notFound,
      timeout,
    },
    idempotency: {
      acknowledge: provider.idempotencyKey(statement.statementId),
    },
    timeoutMs: provider.timeoutMs,
    retriableCodes: [...provider.retriableCodes].sort(),
  });
};

export default spec;
