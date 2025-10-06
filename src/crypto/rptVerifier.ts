import crypto from "crypto";
import { AwsKmsEd25519 } from "./kms";
import { RptToken, canonicalizeRptToken, canonicalToBytes, rawPublicKeyToPem } from "./rptSigner";

export interface SignedRptEnvelope {
  token: RptToken;
  signature: string;
}

export type VerificationFailure = "UNKNOWN_KID" | "EXPIRED" | "GRACE_EXCEEDED" | "INVALID_SIGNATURE" | "MALFORMED";

export type VerificationResult =
  | { valid: true; kid: string; keyType: "current" | "old" }
  | { valid: false; reason: VerificationFailure; kid?: string; keyType?: "current" | "old" };

interface KeyResolution {
  pem: string;
  type: "current" | "old";
}

let currentPemPromise: Promise<string | null> | null = null;
let oldPemPromise: Promise<string | null> | null = null;

function envFlag(name: string): string {
  return String(process.env[name] ?? "");
}

function resolveCurrentKid(): string | undefined {
  return process.env.RPT_KMS_KEY_ID || process.env.RPT_LOCAL_KEY_ID || undefined;
}

function resolveOldKid(): string | undefined {
  return process.env.RPT_KMS_KEY_ID_OLD || process.env.RPT_LOCAL_KEY_ID_OLD || undefined;
}

function graceMillis(): number {
  const raw = process.env.RPT_ROTATION_GRACE_DAYS;
  if (!raw) return 0;
  const days = Number(raw);
  return Number.isFinite(days) && days > 0 ? days * 24 * 60 * 60 * 1000 : 0;
}

function toPemFromEnv(baseName: string, isOld: boolean): string | null {
  const pemEnv = process.env[isOld ? `${baseName}_OLD` : baseName];
  if (pemEnv) return pemEnv;
  return null;
}

function deriveLocalPem(isOld: boolean): string | null {
  const explicitPem = toPemFromEnv("RPT_PUBLIC_KEY_PEM", isOld) || toPemFromEnv("RPT_PUBLIC_PEM", isOld);
  if (explicitPem) return explicitPem;
  const b64 = toPemFromEnv("RPT_PUBLIC_BASE64", isOld);
  if (!b64) return null;
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) {
    throw new Error(`RPT_PUBLIC_BASE64${isOld ? "_OLD" : ""} must decode to 32 bytes`);
  }
  return rawPublicKeyToPem(new Uint8Array(raw));
}

async function fetchPemForKey(keyId: string, isOld: boolean): Promise<string | null> {
  const useKms = envFlag("FEATURE_KMS").toLowerCase() === "true";
  if (useKms) {
    const kms = new AwsKmsEd25519({ keyId });
    return kms.getPublicKeyPEM();
  }
  return deriveLocalPem(isOld);
}

async function getCurrentPem(): Promise<string | null> {
  if (!currentPemPromise) {
    const keyId = resolveCurrentKid();
    if (!keyId) return null;
    currentPemPromise = fetchPemForKey(keyId, false);
  }
  return currentPemPromise;
}

async function getOldPem(): Promise<string | null> {
  if (!oldPemPromise) {
    const keyId = resolveOldKid();
    if (!keyId) return null;
    oldPemPromise = fetchPemForKey(keyId, true);
  }
  return oldPemPromise;
}

async function resolveKey(kid: string): Promise<KeyResolution | null> {
  const currentKid = resolveCurrentKid();
  if (currentKid && kid === currentKid) {
    const pem = await getCurrentPem();
    if (!pem) return null;
    return { pem, type: "current" };
  }
  const oldKid = resolveOldKid();
  if (oldKid && kid === oldKid) {
    const pem = await getOldPem();
    if (!pem) return null;
    return { pem, type: "old" };
  }
  return null;
}

export async function verifySignedRpt(envelope: SignedRptEnvelope, now: Date = new Date()): Promise<VerificationResult> {
  try {
    if (!envelope || typeof envelope.signature !== "string" || !envelope.token) {
      return { valid: false, reason: "MALFORMED" };
    }
    const { token, signature } = envelope;
    if (!token.kid) {
      return { valid: false, reason: "MALFORMED" };
    }
    const resolution = await resolveKey(token.kid);
    if (!resolution) {
      return { valid: false, reason: "UNKNOWN_KID" };
    }
    const nowMs = now.getTime();
    if (token.exp) {
      const expMs = Date.parse(token.exp);
      if (Number.isNaN(expMs) || nowMs > expMs) {
        return { valid: false, reason: "EXPIRED", kid: token.kid, keyType: resolution.type };
      }
    }
    if (resolution.type === "old") {
      const grace = graceMillis();
      if (!token.issuedAt) {
        return { valid: false, reason: "MALFORMED", kid: token.kid, keyType: resolution.type };
      }
      const issuedMs = Date.parse(token.issuedAt);
      if (Number.isNaN(issuedMs)) {
        return { valid: false, reason: "MALFORMED", kid: token.kid, keyType: resolution.type };
      }
      if (grace <= 0 || nowMs - issuedMs > grace) {
        return { valid: false, reason: "GRACE_EXCEEDED", kid: token.kid, keyType: resolution.type };
      }
    }
    const canonical = canonicalizeRptToken(token);
    const message = canonicalToBytes(canonical);
    const sigBytes = Buffer.from(signature, "base64url");
    const key = crypto.createPublicKey(resolution.pem);
    const ok = crypto.verify(null, Buffer.from(message), key, sigBytes);
    if (!ok) {
      return { valid: false, reason: "INVALID_SIGNATURE", kid: token.kid, keyType: resolution.type };
    }
    return { valid: true, kid: token.kid, keyType: resolution.type };
  } catch (err) {
    return { valid: false, reason: "MALFORMED" };
  }
}

export function resetRptVerifierCache(): void {
  currentPemPromise = null;
  oldPemPromise = null;
}
