/** PayTo BAS Sweep adapter (stub) */
export interface PayToDebitResult { status: "OK"|"INSUFFICIENT_FUNDS"|"BANK_ERROR"; bank_ref?: string; }
export async function createMandate(abn: string, capCents: number, reference: string) { return { status: "OK", mandateId: "demo-mandate" }; }
export async function debit(abn: string, amountCents: number, reference: string): Promise<PayToDebitResult> { return { status: "OK", bank_ref: "payto:" + reference.slice(0,12) }; }
export async function cancelMandate(mandateId: string) { return { status: "OK" }; }
