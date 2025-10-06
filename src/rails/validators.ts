export type Rail = "EFT" | "BPAY";

export interface EftDetails {
  bsb: string;
  accountNumber: string;
  accountName?: string;
  statementRef?: string;
}

export interface BpayDetails {
  billerCode: string;
  crn: string;
  statementRef?: string;
}

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
const CRN_WEIGHTS = [3, 1, 7, 9];

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

export function validateAbn(abn: string): string {
  const clean = digitsOnly(String(abn));
  if (clean.length !== 11) {
    throw new Error("INVALID_ABN");
  }
  const adjusted = (Number(clean[0]) - 1).toString() + clean.slice(1);
  const sum = adjusted
    .split("")
    .map((d, idx) => Number(d) * ABN_WEIGHTS[idx])
    .reduce((acc, cur) => acc + cur, 0);
  if (sum % 89 !== 0) {
    throw new Error("INVALID_ABN_CHECKSUM");
  }
  return clean;
}

export function validateEft(details: EftDetails): EftDetails {
  const bsb = digitsOnly(details.bsb);
  if (!/^\d{6}$/.test(bsb)) {
    throw new Error("INVALID_BSB");
  }
  const acct = digitsOnly(details.accountNumber);
  if (!/^\d{4,10}$/.test(acct)) {
    throw new Error("INVALID_ACCOUNT_NUMBER");
  }
  return {
    bsb,
    accountNumber: acct,
    accountName: details.accountName?.trim() || undefined,
    statementRef: details.statementRef?.trim() || undefined,
  };
}

export function validateBpay(details: BpayDetails): BpayDetails {
  const biller = digitsOnly(details.billerCode);
  if (!/^\d{4,6}$/.test(biller)) {
    throw new Error("INVALID_BILLER");
  }
  const crn = digitsOnly(details.crn);
  if (!/^\d{2,20}$/.test(crn) || !passesCrnChecksum(crn)) {
    throw new Error("INVALID_CRN");
  }
  return {
    billerCode: biller,
    crn,
    statementRef: details.statementRef?.trim() || undefined,
  };
}

function passesCrnChecksum(crn: string): boolean {
  const digits = crn.split("").reverse().map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const weight = CRN_WEIGHTS[i % CRN_WEIGHTS.length];
    sum += digits[i] * weight;
  }
  return sum % 10 === 0;
}
