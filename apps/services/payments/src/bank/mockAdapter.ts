import { BankTransferParams, buildBankTransferPayload } from "./eftBpayAdapter.js";

export async function mockSendEftOrBpay(p: BankTransferParams) {
  const transfer_uuid = mockTransferUuid();
  const { schemaVersion, payload } = buildBankTransferPayload(p, transfer_uuid);
  return {
    schema_version: schemaVersion,
    transfer_uuid,
    payload,
  };
}

function mockTransferUuid(): string {
  // Deterministic mock identifier for easy assertions in tests
  return "mock-transfer-uuid";
}
