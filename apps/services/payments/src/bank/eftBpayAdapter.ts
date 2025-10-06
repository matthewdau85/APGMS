import { randomUUID } from "node:crypto";
import { sha256Hex } from "../utils/crypto.js";
import { getBankingPort } from "../banking/index.js";

export type Params = {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  destination: { bpay_biller?: string; crn?: string; bsb?: string; acct?: string; reference?: string };
  idempotencyKey: string;
};

export async function sendEftOrBpay(p: Params): Promise<{ transfer_uuid: string; bank_receipt_hash: string; provider_receipt_id: string }> {
  const port = getBankingPort();
  const transferUuid = randomUUID();
  const amount = Math.abs(p.amount_cents);
  if (p.destination.bpay_biller) {
    const result = await port.bpay({
      abn: p.abn,
      taxType: p.taxType,
      periodId: p.periodId,
      amountCents: amount,
      transferUuid,
      idempotencyKey: p.idempotencyKey,
      billerCode: p.destination.bpay_biller,
      crn: p.destination.crn ?? "",
    });
    return {
      transfer_uuid: result.transferUuid,
      bank_receipt_hash: sha256Hex(result.providerRef),
      provider_receipt_id: result.providerRef,
    };
  }
  const result = await port.eft({
    abn: p.abn,
    taxType: p.taxType,
    periodId: p.periodId,
    amountCents: amount,
    transferUuid,
    idempotencyKey: p.idempotencyKey,
    bsb: p.destination.bsb ?? "",
    accountNumber: p.destination.acct ?? "",
    lodgementReference: p.destination.reference ?? "",
  });
  return {
    transfer_uuid: result.transferUuid,
    bank_receipt_hash: sha256Hex(result.providerRef),
    provider_receipt_id: result.providerRef,
  };
}
