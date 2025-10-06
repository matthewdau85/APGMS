import nacl from "tweetnacl";
import { RptPayload } from "../crypto/ed25519";
import { canonicalJson } from "../utils/json";
import { sha256Hex } from "../crypto/merkle";
import { RATES_VERSION, RPT_ROTATION_GRACE_SECONDS } from "./constants";

export interface RptRecord {
  payload: RptPayload;
  payload_c14n?: string | null;
  payload_sha256?: string | null;
  signature: string;
  rates_version: string;
  kid: string;
  exp: string;
  nonce: string;
}

export interface VerifiedRpt {
  payload: RptPayload;
  payloadHash: string;
  kid: string;
  nonce: string;
  exp: Date;
}

const keyCache = new Map<string, Uint8Array>();

function loadTrustedKeys() {
  if (keyCache.size > 0) return;
  const mapped = process.env.RPT_PUBLIC_KEYS;
  if (mapped) {
    mapped.split(",").forEach(entry => {
      const [kid, keyB64] = entry.split(":");
      if (kid && keyB64) {
        keyCache.set(kid.trim(), Buffer.from(keyB64.trim(), "base64"));
      }
    });
  }
  if (keyCache.size === 0) {
    const fallback = process.env.RPT_PUBLIC_BASE64;
    if (fallback) {
      const kid = process.env.RPT_ED25519_KID ?? "apgms-demo";
      keyCache.set(kid, Buffer.from(fallback, "base64"));
    }
  }
}

function decodeSignature(signature: string): Uint8Array {
  return new Uint8Array(Buffer.from(signature, "base64url"));
}

function getTrustedKey(kid: string): Uint8Array {
  loadTrustedKeys();
  const key = keyCache.get(kid);
  if (!key) {
    throw new Error("UNKNOWN_KID");
  }
  return key;
}

export function verifyRptRecord(record: RptRecord): VerifiedRpt {
  if (!record) throw new Error("MISSING_RPT");
  if (record.rates_version !== RATES_VERSION) {
    throw new Error("BAD_RATES_VERSION");
  }
  const exp = new Date(record.exp);
  if (Number.isNaN(exp.getTime())) {
    throw new Error("BAD_EXP");
  }
  const graceMs = RPT_ROTATION_GRACE_SECONDS * 1000;
  if (Date.now() > exp.getTime() + graceMs) {
    throw new Error("RPT_EXPIRED");
  }

  const payloadStr = record.payload_c14n ?? canonicalJson(record.payload);
  const computedHash = sha256Hex(payloadStr);
  if (record.payload_sha256 && record.payload_sha256 !== computedHash) {
    throw new Error("PAYLOAD_HASH_MISMATCH");
  }

  const key = getTrustedKey(record.kid);
  const msg = new TextEncoder().encode(payloadStr);
  const sig = decodeSignature(record.signature);
  const verified = nacl.sign.detached.verify(msg, sig, key);
  if (!verified) {
    throw new Error("RPT_SIGNATURE_INVALID");
  }

  return {
    payload: record.payload,
    payloadHash: computedHash,
    kid: record.kid,
    nonce: record.nonce,
    exp,
  };
}
