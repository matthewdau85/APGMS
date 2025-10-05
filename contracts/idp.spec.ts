import assert from "node:assert/strict";
import type { IdpPort } from "./interfaces";
import type { ContractSpec } from "./types";
import { makeReport } from "./types";
import { describeValue } from "./utils";

const spec: ContractSpec = async (ctx) => {
  const provider = await ctx.load<IdpPort>();
  const credentials = { username: "apgms", password: "correct-horse-battery-staple" };

  const auth = await provider.authenticate(credentials);
  assert.equal(typeof auth.token, "string");
  assert.equal(typeof auth.expiresAt, "string");

  const refreshed = await provider.refresh(auth.token);
  assert.equal(typeof refreshed.token, "string");
  assert.equal(typeof refreshed.expiresAt, "string");

  const unauthorized = await provider.simulateError("unauthorized");
  assert.equal(unauthorized.code, "IDP_UNAUTHORIZED");
  assert.equal(unauthorized.retriable, false);

  const timeout = await provider.simulateError("timeout");
  assert.equal(timeout.code, "IDP_TIMEOUT");
  assert.equal(timeout.retriable, true);

  assert.ok(provider.timeoutMs > 0);

  return makeReport(ctx, {
    responseTypes: {
      authenticate: describeValue(auth),
      refresh: describeValue(refreshed),
    },
    errors: {
      unauthorized,
      timeout,
    },
    idempotency: {
      authenticate: provider.idempotencyKey(credentials),
    },
    timeoutMs: provider.timeoutMs,
    retriableCodes: [...provider.retriableCodes].sort(),
  });
};

export default spec;
