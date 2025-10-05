import assert from "node:assert/strict";
import { TextEncoder } from "node:util";
import type { KmsPort } from "./interfaces";
import type { ContractSpec } from "./types";
import { makeReport } from "./types";
import { describeValue } from "./utils";

const encoder = new TextEncoder();

const spec: ContractSpec = async (ctx) => {
  const provider = await ctx.load<KmsPort>();
  const payload = encoder.encode("contract-test-payload");

  const signature1 = await provider.sign(payload);
  const signature2 = await provider.sign(payload);
  assert.equal(Buffer.from(signature1).toString("hex"), Buffer.from(signature2).toString("hex"));

  const verified = await provider.verify(payload, signature1);
  assert.equal(verified, true);

  const tampered = encoder.encode("contract-test-payload!");
  const tamperedVerification = await provider.verify(tampered, signature1);
  assert.equal(tamperedVerification, false);

  const badKeyError = await provider.simulateError("bad_key");
  assert.equal(badKeyError.code, "KMS_BAD_KEY");
  assert.equal(badKeyError.retriable, false);

  const timeoutError = await provider.simulateError("timeout");
  assert.equal(timeoutError.code, "KMS_TIMEOUT");
  assert.equal(timeoutError.retriable, true);

  assert.ok(provider.timeoutMs > 0);

  return makeReport(ctx, {
    responseTypes: {
      sign: describeValue(signature1),
      verify: describeValue(verified),
    },
    errors: {
      bad_key: badKeyError,
      timeout: timeoutError,
    },
    idempotency: {
      sign: Buffer.from(signature1).toString("hex"),
    },
    timeoutMs: provider.timeoutMs,
    retriableCodes: [...provider.retriableCodes].sort(),
  });
};

export default spec;
