import { createMandate, debit, cancelMandate } from "../../../../src/payto/adapter.js";

test("payto mandate lifecycle", async () => {
  const mandate = await createMandate("123", 5000, "mandate-1");
  expect(mandate.status).toBe("CREATED");
  const ok = await debit("123", 2000, "mandate-1");
  expect(ok.status).toBe("OK");
  const cancel = await cancelMandate(mandate.mandateId!);
  expect(cancel.status).toBe("CANCELLED");
  const afterCancel = await debit("123", 1000, "mandate-1");
  expect(afterCancel.status).toBe("MANDATE_CANCELLED");
});

test("payto debit failure modes", async () => {
  await createMandate("456", 1000, "mandate-fail-insufficient");
  const insufficient = await debit("456", 2000, "mandate-fail-insufficient");
  expect(insufficient.status).toBe("INSUFFICIENT_FUNDS");

  await createMandate("789", 1000, "mandate-fail-bank-once");
  const first = await debit("789", 500, "mandate-fail-bank-once");
  expect(first.status).toBe("BANK_ERROR");
  const second = await debit("789", 500, "mandate-fail-bank-once");
  expect(second.status).toBe("OK");
});
