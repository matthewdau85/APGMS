import { RptPayload, isExpired } from "../crypto/ed25519";
import { verifyRpt as verifyRptSignature } from "../crypto/kms";
import { FEATURE_ATO_TABLES, RATES_VERSION } from "./config";

export class RptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RptValidationError";
  }
}

export async function validateRptPayload(payload: RptPayload, signature: string): Promise<boolean> {
  if (!FEATURE_ATO_TABLES) {
    return true;
  }

  if (!payload) {
    throw new RptValidationError("MISSING_PAYLOAD");
  }
  if (!signature) {
    throw new RptValidationError("MISSING_SIGNATURE");
  }
  if (payload.rates_version !== RATES_VERSION) {
    throw new RptValidationError("RATES_VERSION_MISMATCH");
  }
  if (!payload.nonce) {
    throw new RptValidationError("MISSING_NONCE");
  }
  if (!payload.expiry_ts) {
    throw new RptValidationError("MISSING_EXPIRY");
  }
  if (Number.isNaN(Date.parse(payload.expiry_ts))) {
    throw new RptValidationError("INVALID_EXPIRY");
  }
  if (isExpired(payload.expiry_ts)) {
    throw new RptValidationError("RPT_EXPIRED");
  }

  const valid = await verifyRptSignature(payload, signature);
  if (!valid) {
    throw new RptValidationError("INVALID_SIGNATURE");
  }

  return true;
}
