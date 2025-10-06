#!/usr/bin/env tsx
import { submitSandboxPayment } from "../../src/adapters/bank/eftSandbox";

async function main() {
  if (process.env.DRY_RUN === "true") {
    throw new Error("smoke:rail must run with DRY_RUN=false");
  }
  const periodId = process.env.SMOKE_PERIOD_ID || "TEST_PERIOD";
  const reference = process.env.SMOKE_PROVIDER_REF || "TEST_REF";
  const bsb = process.env.SMOKE_BSB || "000000";
  const account = process.env.SMOKE_ACCOUNT || "00000000";
  const amount = Number(process.env.SMOKE_AMOUNT_CENTS || "100");

  const result = await submitSandboxPayment({
    periodId,
    reference,
    bsb,
    account,
    amountCents: amount,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("[smoke:rail] failed", err);
  process.exitCode = 1;
});
