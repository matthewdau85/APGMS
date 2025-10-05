const allowList = new Set(
  (process.env.ALLOWLIST_ABNS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
);

export function assertAbnAllowed(abn: string) {
  if (allowList.size === 0) {
    return;
  }

  if (!allowList.has(abn)) {
    const error = new Error("ABN_NOT_ALLOWLISTED");
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}

export function assertValidBsb(bsb: string): string {
  const normalized = bsb.replace(/[^0-9]/g, "");
  if (normalized.length !== 6) {
    throw buildValidationError("INVALID_BSB");
  }
  return normalized;
}

export function assertValidCrn(crn: string): string {
  const normalized = crn.replace(/\s+/g, "");
  if (!/^[-A-Za-z0-9]{2,20}$/.test(normalized)) {
    throw buildValidationError("INVALID_CRN");
  }
  return normalized.toUpperCase();
}

function buildValidationError(code: string) {
  const error = new Error(code);
  (error as Error & { statusCode?: number }).statusCode = 400;
  return error;
}
