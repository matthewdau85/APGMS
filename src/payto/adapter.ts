/** PayTo BAS Sweep adapter (stub) */
import { MoneyCents, expectMoneyCents } from "../../libs/money";

export interface PayToDebitResult {
  status: "OK" | "INSUFFICIENT_FUNDS" | "BANK_ERROR";
  bank_ref?: string;
}

export async function createMandate(abn: string, capCents: MoneyCents, reference: string) {
  expectMoneyCents(capCents, "capCents");
  return { status: "OK", mandateId: "demo-mandate" };
}

export async function debit(abn: string, amountCents: MoneyCents, reference: string): Promise<PayToDebitResult> {
  expectMoneyCents(amountCents, "amountCents");
  return { status: "OK", bank_ref: "payto:" + reference.slice(0, 12) };
}

export async function cancelMandate(mandateId: string) {
  return { status: "OK" };
}
