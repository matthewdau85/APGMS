import crypto from "crypto";
import { getTenantWebhookSecret } from "../tenants/secrets";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export interface VerifySignatureArgs {
  tenantId: string;
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
  toleranceMs?: number;
  secretOverride?: string;
}

export interface VerifyResult {
  valid: boolean;
  computed?: string;
  reason?: string;
}

export function computeSignature(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export async function verifySignature(args: VerifySignatureArgs): Promise<VerifyResult> {
  const { tenantId, rawBody, signature, timestamp } = args;
  if (!signature) {
    return { valid: false, reason: "MISSING_SIGNATURE" };
  }
  if (!timestamp) {
    return { valid: false, reason: "MISSING_TIMESTAMP" };
  }
  const secret = args.secretOverride ?? (await getTenantWebhookSecret(tenantId));
  if (!secret) {
    return { valid: false, reason: "SECRET_NOT_FOUND" };
  }
  const now = Date.now();
  const tolerance = args.toleranceMs ?? FIVE_MINUTES_MS;
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) {
    return { valid: false, reason: "INVALID_TIMESTAMP" };
  }
  if (Math.abs(now - numericTimestamp) > tolerance) {
    return { valid: false, reason: "TIMESTAMP_OUT_OF_WINDOW" };
  }
  const computed = computeSignature(secret, timestamp, rawBody);
  try {
    const expected = Buffer.from(computed, "hex");
    const received = Buffer.from(signature, "hex");
    if (expected.length !== received.length) {
      return { valid: false, computed, reason: "SIGNATURE_LENGTH_MISMATCH" };
    }
    const match = crypto.timingSafeEqual(expected, received);
    return { valid: match, computed, reason: match ? undefined : "SIGNATURE_MISMATCH" };
  } catch (err) {
    return { valid: false, computed, reason: "SIGNATURE_FORMAT_ERROR" };
  }
}
