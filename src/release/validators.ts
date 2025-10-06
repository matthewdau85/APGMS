import { HttpError } from "../utils/errors";

const allowlist = new Set(
  (process.env.ALLOWLIST_ABNS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
);

export function validateABNAllowlist(abn: string) {
  if (!allowlist.size) return; // allow all if no allowlist configured
  if (!allowlist.has(abn)) {
    throw new HttpError(403, "ABN_NOT_ALLOWLISTED", "ABN not allow-listed", `ABN ${abn} is not approved for outbound payments.`);
  }
}

export function validateBSB(bsb: string) {
  if (!/^\d{6}$/.test(bsb)) {
    throw new HttpError(400, "INVALID_BSB", "Invalid BSB", "BSB must be exactly 6 digits.");
  }
}

export function validateAcct(acct: string) {
  if (!/^\d{6,10}$/.test(acct)) {
    throw new HttpError(400, "INVALID_ACCOUNT", "Invalid account number", "Account number must be 6-10 digits.");
  }
}

export function validateCRN(crn: string) {
  if (!/^[A-Za-z0-9]{2,20}$/.test(crn)) {
    throw new HttpError(400, "INVALID_CRN", "Invalid CRN", "CRN must be 2-20 alphanumeric characters.");
  }
}
