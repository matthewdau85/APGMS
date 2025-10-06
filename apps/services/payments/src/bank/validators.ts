import { ABN_ALLOWLIST, DEFAULT_BPAY_BILLER } from '../config.js';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const BSB_REGEX = /^\d{3}-?\d{3}$/;
const ACCOUNT_REGEX = /^\d{5,12}$/;
const CRN_REGEX = /^\d{6,20}$/;

export type EftDestination = { bsb: string; account: string };
export type BpayDestination = { billerCode: string; crn: string };
export type PayToDestination = { mandateId: string };

export function assertAbnAllowlisted(abn: string) {
  if (ABN_ALLOWLIST.size === 0) return;
  if (!ABN_ALLOWLIST.has(abn)) {
    throw new ValidationError('ABN_NOT_ALLOWLISTED');
  }
}

export function validateBsbAccount(dest: EftDestination) {
  if (!BSB_REGEX.test(dest.bsb)) {
    throw new ValidationError('INVALID_BSB');
  }
  if (!ACCOUNT_REGEX.test(dest.account)) {
    throw new ValidationError('INVALID_ACCOUNT');
  }
}

export function validateBpayDestination(dest: BpayDestination) {
  if (!CRN_REGEX.test(dest.crn)) {
    throw new ValidationError('INVALID_CRN_FORMAT');
  }
  if (!checkBpayChecksum(dest.crn)) {
    throw new ValidationError('INVALID_CRN_CHECKSUM');
  }
  if (dest.billerCode !== DEFAULT_BPAY_BILLER) {
    throw new ValidationError('BILLER_NOT_ALLOWED');
  }
}

const WEIGHTS = [3, 1, 7, 9];
function checkBpayChecksum(crn: string): boolean {
  if (crn.length < 2) return false;
  const digits = crn.split('').map((d) => Number(d));
  const checkDigit = digits.pop();
  if (checkDigit == null || Number.isNaN(checkDigit)) return false;
  let sum = 0;
  for (let i = digits.length - 1, w = 0; i >= 0; i--, w++) {
    const digit = digits[i];
    if (Number.isNaN(digit)) return false;
    const weight = WEIGHTS[w % WEIGHTS.length];
    sum += digit * weight;
  }
  const calc = (10 - (sum % 10)) % 10;
  return calc === checkDigit;
}

export function requireIdempotencyKey(key: string | undefined): string {
  if (!key || !key.trim()) {
    throw new ValidationError('IDEMPOTENCY_KEY_REQUIRED');
  }
  return key;
}
