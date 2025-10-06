export type ValidationError = {
  code: string;
  title: string;
  detail: string;
  requestId: string;
};

type Rail = "EFT" | "BPAY";

type Destination = {
  bsb?: string;
  account?: string;
  bpay_biller?: string;
  crn?: string;
};

function err(code: string, title: string, detail: string, requestId: string): ValidationError {
  return { code, title, detail, requestId };
}

export function validateABNAllowlist(
  abn: string,
  rail: Rail,
  destination: Destination,
  requestId: string
): ValidationError | null {
  if (rail === "BPAY") {
    if (destination.bpay_biller !== "75556") {
      return err("ALLOWLIST_DENIED", "Destination not allow-listed", `ABN ${abn} cannot pay biller ${destination.bpay_biller ?? ""}`, requestId);
    }
    if (!destination.crn || destination.crn.length < 10) {
      return err("ALLOWLIST_DENIED", "Missing CRN", "BPAY destinations require a CRN", requestId);
    }
  }
  if (rail === "EFT") {
    if (!destination.bsb || !destination.account) {
      return err("ALLOWLIST_DENIED", "Incomplete EFT destination", "BSB and account are required for EFT", requestId);
    }
  }
  return null;
}

export function validateBSB(bsb: string | undefined, requestId: string): ValidationError | null {
  if (!bsb) return err("INVALID_BSB", "BSB required", "Destination BSB is required for EFT", requestId);
  const digits = bsb.replace(/[^0-9]/g, "");
  if (!/^\d{6}$/.test(digits)) {
    return err("INVALID_BSB", "Invalid BSB", "BSB must be six digits", requestId);
  }
  return null;
}

export function validateAcct(account: string | undefined, requestId: string): ValidationError | null {
  if (!account) return err("INVALID_ACCOUNT", "Account required", "Bank account number is required for EFT", requestId);
  const digits = account.replace(/[^0-9]/g, "");
  if (digits.length < 6 || digits.length > 10) {
    return err("INVALID_ACCOUNT", "Invalid account number", "Account number must be between 6 and 10 digits", requestId);
  }
  return null;
}

export function validateCRN(crn: string | undefined, requestId: string): ValidationError | null {
  if (!crn) return err("INVALID_CRN", "CRN required", "BPAY CRN is required", requestId);
  const sanitized = crn.replace(/\s+/g, "");
  if (!/^\d{8,20}$/.test(sanitized)) {
    return err("INVALID_CRN", "Invalid CRN", "CRN must be 8-20 numeric characters", requestId);
  }
  return null;
}
