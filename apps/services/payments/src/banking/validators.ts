import { BankingValidationError } from "./errors.js";

const BSB_PATTERN = /^\d{3}-?\d{3}$/;
const ACCOUNT_PATTERN = /^\d{6,10}$/;
const BILLER_PATTERN = /^\d{4,8}$/;

export function normalizeBsb(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

export function validateBsbAccount(bsb: string | null | undefined, account: string | null | undefined) {
  const normalizedBsb = normalizeBsb(String(bsb ?? ""));
  const normalizedAccount = String(account ?? "").replace(/\s+/g, "");
  if (!BSB_PATTERN.test(normalizedBsb)) {
    throw new BankingValidationError("INVALID_BSB", "BSB must be 6 digits");
  }
  if (!ACCOUNT_PATTERN.test(normalizedAccount)) {
    throw new BankingValidationError("INVALID_ACCOUNT", "Account number must be 6-10 digits");
  }
  return { bsb: normalizedBsb, account: normalizedAccount };
}

export function validateBillerCode(billerCode: string | null | undefined) {
  const cleaned = String(billerCode ?? "").replace(/\s+/g, "");
  if (!BILLER_PATTERN.test(cleaned)) {
    throw new BankingValidationError("INVALID_BPAY_BILLER", "BPAY biller code must be 4-8 digits");
  }
  return cleaned;
}

export function normalizeCrn(input: string): string {
  return input.replace(/\s+/g, "");
}

const BPAY_WEIGHTS = [3, 1, 7, 9];

export function validateCrn(crn: string | null | undefined) {
  const cleaned = normalizeCrn(String(crn ?? ""));
  if (!/^\d{6,20}$/.test(cleaned)) {
    throw new BankingValidationError("INVALID_CRN", "CRN must be numeric and between 6-20 digits");
  }
  let sum = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const digit = Number.parseInt(cleaned[cleaned.length - 1 - i], 10);
    sum += digit * BPAY_WEIGHTS[i % BPAY_WEIGHTS.length];
  }
  if (sum % 10 !== 0) {
    throw new BankingValidationError("INVALID_CRN", "CRN checksum failed");
  }
  return cleaned;
}
