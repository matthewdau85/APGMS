import { parse } from "csv-parse/sync";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import nacl from "tweetnacl";

export interface SettlementEnvelope {
  file_id: string;
  generated_at: string;
  schema_version?: string;
  signer_key_id?: string;
  signature: string;
  hmac_key_id?: string;
  hmac: string;
  csv: string;
}

export interface SettlementRow {
  txn_id: string;
  gst_cents: number;
  net_cents: number;
  settlement_ts: string;
}

export interface SettlementValidationOptions {
  /** Allow callers to override signer key material (base64/base64url/hex) */
  signerKeys?: Record<string, string>;
  /** Allow callers to override HMAC secrets (base64/base64url/hex) */
  hmacSecrets?: Record<string, string>;
  /** Maximum acceptable skew (minutes) between `generated_at` and now */
  maxClockSkewMinutes?: number;
  /** Clock override for testing */
  now?: () => Date;
  /**
   * Optional replay guard – should return true when the given file has already
   * been seen (and therefore must be rejected).
   */
  hasSeen?: (fileId: string) => Promise<boolean> | boolean;
}

export interface SettlementValidationResult {
  fileId: string;
  schemaVersion: string;
  generatedAt: string;
  signerKeyId: string;
  hmacKeyId: string;
  csvHash: string;
  canonicalMessage: string;
  rows: SettlementRow[];
  rawCsv: string;
  signatureValid: boolean;
  hmacValid: boolean;
  timestampSkewMinutes: number;
}

export class SettlementValidationError extends Error {
  constructor(public code: string, message: string, public details?: Record<string, any>) {
    super(message);
    this.name = "SettlementValidationError";
  }
}

const DEFAULT_SCHEMA_VERSION = "2025-10";
const DEFAULT_ALLOWED_SCHEMAS = new Set([DEFAULT_SCHEMA_VERSION]);
const DEFAULT_MAX_SKEW_MINUTES = 15;

function getSignerKeysFromEnv(): Record<string, string> {
  const raw = process.env.SETTLEMENT_SIGNER_KEYS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Signer config must be an object");
      }
      return parsed;
    } catch (err: any) {
      throw new SettlementValidationError(
        "SIGNER_CONFIG_INVALID",
        `Unable to parse SETTLEMENT_SIGNER_KEYS: ${err.message}`
      );
    }
  }

  const single = process.env.SETTLEMENT_SIGNER_PUBLIC_KEY;
  if (single) {
    return { primary: single };
  }

  throw new SettlementValidationError(
    "SIGNER_CONFIG_MISSING",
    "No signer keys configured. Set SETTLEMENT_SIGNER_KEYS or SETTLEMENT_SIGNER_PUBLIC_KEY."
  );
}

function getHmacSecretsFromEnv(): Record<string, string> {
  const raw = process.env.SETTLEMENT_HMAC_SECRETS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("HMAC config must be an object");
      }
      return parsed;
    } catch (err: any) {
      throw new SettlementValidationError(
        "HMAC_CONFIG_INVALID",
        `Unable to parse SETTLEMENT_HMAC_SECRETS: ${err.message}`
      );
    }
  }

  const single = process.env.SETTLEMENT_HMAC_SECRET;
  if (single) {
    return { primary: single };
  }

  throw new SettlementValidationError(
    "HMAC_CONFIG_MISSING",
    "No HMAC secrets configured. Set SETTLEMENT_HMAC_SECRETS or SETTLEMENT_HMAC_SECRET."
  );
}

function decodeKey(material: string, label: string): Buffer {
  const value = (material || "").trim();
  if (!value) {
    throw new SettlementValidationError("KEY_MISSING", `${label} is not configured`);
  }
  const encodings: BufferEncoding[] = ["base64url", "base64", "hex"];
  for (const enc of encodings) {
    try {
      const buf = Buffer.from(value, enc);
      if (buf.length > 0) {
        return buf;
      }
    } catch {
      // try next encoding
    }
  }
  throw new SettlementValidationError(
    "KEY_DECODE_FAILED",
    `${label} must be base64url, base64, or hex encoded`
  );
}

function toIsoString(date: Date): string {
  return new Date(date.getTime()).toISOString();
}

function ensureEnvelope(payload: any): asserts payload is SettlementEnvelope {
  if (!payload || typeof payload !== "object") {
    throw new SettlementValidationError("PAYLOAD_TYPE", "Settlement payload must be an object");
  }
  const requiredFields: Array<keyof SettlementEnvelope> = [
    "file_id",
    "generated_at",
    "signature",
    "hmac",
    "csv",
  ];
  for (const field of requiredFields) {
    if (typeof payload[field] !== "string" || !payload[field]) {
      throw new SettlementValidationError("PAYLOAD_FIELD", `Missing or invalid field: ${field}`);
    }
  }
}

function validateSchemaVersion(version: string): string {
  if (!DEFAULT_ALLOWED_SCHEMAS.has(version)) {
    throw new SettlementValidationError(
      "SCHEMA_VERSION_UNSUPPORTED",
      `Unsupported settlement schema: ${version}`,
      { allowed: Array.from(DEFAULT_ALLOWED_SCHEMAS), received: version }
    );
  }
  return version;
}

function validateTimestamp(generatedAt: Date, now: Date, maxSkewMinutes: number): number {
  const deltaMinutes = Math.abs(now.getTime() - generatedAt.getTime()) / 60000;
  if (deltaMinutes > maxSkewMinutes) {
    throw new SettlementValidationError(
      "TIMESTAMP_OUT_OF_RANGE",
      "Settlement file timestamp outside allowable skew",
      { generated_at: generatedAt.toISOString(), now: now.toISOString(), skew_minutes: deltaMinutes }
    );
  }
  return deltaMinutes;
}

function canonicalizePayload(fileId: string, generatedAt: string, schemaVersion: string, csvHash: string) {
  return JSON.stringify({ file_id: fileId, generated_at: generatedAt, schema_version: schemaVersion, csv_sha256: csvHash });
}

function validateSignature(message: string, signature: string, keyMaterial: string): void {
  const signatureBuf = decodeKey(signature, "signature");
  const publicKey = decodeKey(keyMaterial, "signer public key");
  if (publicKey.length !== nacl.sign.publicKeyLength) {
    throw new SettlementValidationError(
      "SIGNER_KEY_LENGTH",
      `Signer key must be ${nacl.sign.publicKeyLength} bytes`);
  }
  const ok = nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    signatureBuf,
    publicKey
  );
  if (!ok) {
    throw new SettlementValidationError("SIGNATURE_INVALID", "Invalid settlement file signature");
  }
}

function validateHmac(message: string, providedHmac: string, secretMaterial: string) {
  const provided = decodeKey(providedHmac, "HMAC value");
  const secret = decodeKey(secretMaterial, "HMAC secret");
  const computed = createHmac("sha256", secret).update(message).digest();
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    throw new SettlementValidationError("HMAC_INVALID", "Settlement HMAC validation failed");
  }
}

function normalizeRow(raw: any, index: number): SettlementRow {
  if (!raw || typeof raw !== "object") {
    throw new SettlementValidationError("ROW_TYPE", `Row ${index + 1} is not an object`);
  }
  const txn = String(raw.txn_id ?? "").trim();
  const gst = Number(raw.gst_cents);
  const net = Number(raw.net_cents);
  const settlementTs = String(raw.settlement_ts ?? "").trim();
  if (!txn) {
    throw new SettlementValidationError("ROW_TXN_ID", `Row ${index + 1} missing txn_id`);
  }
  if (!Number.isFinite(gst) || !Number.isInteger(gst)) {
    throw new SettlementValidationError("ROW_GST", `Row ${index + 1} has invalid gst_cents`);
  }
  if (!Number.isFinite(net) || !Number.isInteger(net)) {
    throw new SettlementValidationError("ROW_NET", `Row ${index + 1} has invalid net_cents`);
  }
  const ts = Date.parse(settlementTs);
  if (Number.isNaN(ts)) {
    throw new SettlementValidationError("ROW_TS", `Row ${index + 1} has invalid settlement_ts`);
  }
  return {
    txn_id: txn,
    gst_cents: gst,
    net_cents: net,
    settlement_ts: new Date(ts).toISOString(),
  };
}

export async function parseSettlementEnvelope(
  payload: any,
  options: SettlementValidationOptions = {}
): Promise<SettlementValidationResult> {
  ensureEnvelope(payload);
  const signerKeys = options.signerKeys ?? getSignerKeysFromEnv();
  const hmacSecrets = options.hmacSecrets ?? getHmacSecretsFromEnv();

  const fileId = payload.file_id.trim();
  const schemaVersion = validateSchemaVersion(payload.schema_version ?? DEFAULT_SCHEMA_VERSION);

  const generatedAtDate = new Date(payload.generated_at);
  if (Number.isNaN(generatedAtDate.getTime())) {
    throw new SettlementValidationError("TIMESTAMP_INVALID", "generated_at is not a valid ISO timestamp");
  }

  const now = options.now?.() ?? new Date();
  const skewMinutes = validateTimestamp(generatedAtDate, now, options.maxClockSkewMinutes ?? DEFAULT_MAX_SKEW_MINUTES);

  if (options.hasSeen) {
    const seen = await options.hasSeen(fileId);
    if (seen) {
      throw new SettlementValidationError("REPLAYED_FILE", "Settlement file already processed", { file_id: fileId });
    }
  }

  const rawCsv = payload.csv;
  const csvHash = createHash("sha256").update(rawCsv, "utf8").digest("base64url");
  const canonicalMessage = canonicalizePayload(fileId, toIsoString(generatedAtDate), schemaVersion, csvHash);

  const signerKeyId = payload.signer_key_id ?? "primary";
  const signerKey = signerKeys[signerKeyId];
  if (!signerKey) {
    throw new SettlementValidationError("SIGNER_KEY_UNKNOWN", `Unknown signer key id: ${signerKeyId}`);
  }
  validateSignature(canonicalMessage, payload.signature, signerKey);

  const hmacKeyId = payload.hmac_key_id ?? "primary";
  const hmacSecret = hmacSecrets[hmacKeyId];
  if (!hmacSecret) {
    throw new SettlementValidationError("HMAC_KEY_UNKNOWN", `Unknown HMAC key id: ${hmacKeyId}`);
  }
  validateHmac(canonicalMessage, payload.hmac, hmacSecret);

  let rawRows: any[];
  try {
    rawRows = parse(rawCsv, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err: any) {
    throw new SettlementValidationError("CSV_PARSE", `Unable to parse settlement CSV: ${err.message}`);
  }
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new SettlementValidationError("CSV_EMPTY", "Settlement file contains no rows");
  }

  const rows = rawRows.map((row, idx) => normalizeRow(row, idx));

  return {
    fileId,
    schemaVersion,
    generatedAt: toIsoString(generatedAtDate),
    signerKeyId,
    hmacKeyId,
    csvHash,
    canonicalMessage,
    rows,
    rawCsv,
    signatureValid: true,
    hmacValid: true,
    timestampSkewMinutes: skewMinutes,
  };
}
