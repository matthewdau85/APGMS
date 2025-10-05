import { bankClient, dollarsToCents } from "./secureBankClient";

function ensureFinite(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

export async function submitSTPReport(data: any): Promise<boolean> {
  await bankClient.submitStpReport(data);
  return true;
}

export async function signTransaction(amount: number, accountAlias: string): Promise<string> {
  ensureFinite(amount, "amount");
  return bankClient.createStandaloneSignature(amount, accountAlias, "UI_MANUAL");
}

export async function transferToOneWayAccount(amount: number, fromAlias: string, toAlias: string): Promise<boolean> {
  ensureFinite(amount, "amount");
  const cents = dollarsToCents(amount);
  await bankClient.transfer({
    amountCents: cents,
    debitAccountAlias: fromAlias,
    creditAccountAlias: toAlias,
    purpose: "OWA_SWEEP",
    narrative: `OWA:${toAlias}`,
  });
  return true;
}

export async function verifyFunds(paygwDue: number, gstDue: number): Promise<boolean> {
  ensureFinite(paygwDue, "paygwDue");
  ensureFinite(gstDue, "gstDue");
  const requiredCents = dollarsToCents(paygwDue + gstDue);
  return bankClient.verifyAvailableFunds(requiredCents);
}

export async function initiateTransfer(paygwDue: number, gstDue: number): Promise<boolean> {
  ensureFinite(paygwDue, "paygwDue");
  ensureFinite(gstDue, "gstDue");
  const paygwCents = dollarsToCents(paygwDue);
  const gstCents = dollarsToCents(gstDue);
  await bankClient.transferTaxAmounts({
    paygwCents,
    gstCents,
    reference: `BAS-${new Date().toISOString().slice(0, 10)}`,
    debitAccountAlias: "__default__",
  });
  return true;
}
