import assert from "node:assert/strict";
import type { RatesPort } from "./interfaces";
import type { ContractSpec } from "./types";
import { makeReport } from "./types";
import { describeValue } from "./utils";

const spec: ContractSpec = async (ctx) => {
  const provider = await ctx.load<RatesPort>();
  const query = { region: "AU", taxYear: 2025 };

  const table = await provider.fetchRates(query);
  assert.equal(Array.isArray(table.brackets), true);
  assert.ok(table.brackets.length >= 1);
  table.brackets.forEach((bracket) => {
    assert.equal(typeof bracket.threshold, "number");
    assert.equal(typeof bracket.rate, "number");
  });

  const repeat = await provider.fetchRates(query);
  assert.deepEqual(repeat, table, "Rate fetch should be idempotent");

  const notFound = await provider.simulateError("not_found");
  assert.equal(notFound.code, "RATES_NOT_FOUND");
  assert.equal(notFound.retriable, false);

  const timeout = await provider.simulateError("timeout");
  assert.equal(timeout.code, "RATES_TIMEOUT");
  assert.equal(timeout.retriable, true);

  assert.ok(provider.timeoutMs > 0);

  return makeReport(ctx, {
    responseTypes: {
      fetchRates: describeValue(table),
    },
    errors: {
      not_found: notFound,
      timeout,
    },
    idempotency: {
      fetchRates: provider.idempotencyKey(query),
    },
    timeoutMs: provider.timeoutMs,
    retriableCodes: [...provider.retriableCodes].sort(),
  });
};

export default spec;
