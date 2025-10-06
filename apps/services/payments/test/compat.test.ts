import { BankTransferParams, buildBankTransferPayload } from "../src/bank/eftBpayAdapter";
import { mockSendEftOrBpay } from "../src/bank/mockAdapter";

const baseParams: BankTransferParams = {
  abn: "12345678901",
  taxType: "PAYGW",
  periodId: "2025-09",
  amount_cents: 1000,
  destination: { bsb: "000000", acct: "123456" },
  idempotencyKey: "test-key",
};

describe("schema_version compatibility", () => {
  test("real adapter helper accepts v1 and v2", () => {
    const v1 = buildBankTransferPayload({ ...baseParams, schema_version: "v1" }, "test-transfer-v1");
    expect(v1.schemaVersion).toBe("v1");
    expect(v1.payload.schema_version).toBe("v1");

    const v2 = buildBankTransferPayload({ ...baseParams, schema_version: "v2" }, "test-transfer-v2");
    expect(v2.schemaVersion).toBe("v2");
    expect(v2.payload.schema_version).toBe("v2");

    expect(() => buildBankTransferPayload({ ...baseParams, schema_version: "v3" }, "bad"))
      .toThrow(/Unsupported schema_version/);
  });

  test("mock adapter mirrors schema acceptance", async () => {
    await expect(mockSendEftOrBpay({ ...baseParams, schema_version: "v1" })).resolves.toMatchObject({
      schema_version: "v1",
    });
    await expect(mockSendEftOrBpay({ ...baseParams, schema_version: "v2" })).resolves.toMatchObject({
      schema_version: "v2",
    });
    await expect(mockSendEftOrBpay({ ...baseParams, schema_version: "v3" })).rejects.toThrow(/Unsupported schema_version/);
  });
});
