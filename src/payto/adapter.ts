// src/payto/adapter.ts
import http from "http";
import https from "https";
import { readFileSync } from "fs";
import { URL } from "url";
import { Pool } from "pg";

import { sha256Hex } from "../crypto/merkle";

export interface PayToDebitResult {
  status: "OK" | "INSUFFICIENT_FUNDS" | "BANK_ERROR";
  bank_ref?: string;
  receipt_hash?: string;
  mandate_id?: string;
  failure_reason?: string;
  remainingCapCents?: number;
}

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>;
};

type BankRequester = <T = any>(method: string, path: string, payload?: unknown) => Promise<T>;

let db: Queryable = new Pool();

function readOptional(path?: string | null) {
  return path ? readFileSync(path) : undefined;
}

function boolFromEnv(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) return defaultValue;
  return !(value.toLowerCase() === "false" || value === "0");
}

function createBankRequester(): BankRequester {
  const base = process.env.PAYTO_API_BASE || process.env.BANK_API_BASE;
  if (!base) {
    return async () => {
      throw new Error("PAYTO_API_BASE (or BANK_API_BASE) is not configured");
    };
  }

  const baseUrl = new URL(base);
  const timeoutMs = Number(process.env.PAYTO_TIMEOUT_MS || process.env.BANK_TIMEOUT_MS || "8000");
  const rejectUnauthorized = boolFromEnv(process.env.PAYTO_TLS_REJECT_UNAUTHORIZED, true);
  const ca = readOptional(process.env.PAYTO_TLS_CA || process.env.BANK_TLS_CA || undefined);
  const cert = readOptional(process.env.PAYTO_TLS_CERT || process.env.BANK_TLS_CERT || undefined);
  const key = readOptional(process.env.PAYTO_TLS_KEY || process.env.BANK_TLS_KEY || undefined);

  const agent = baseUrl.protocol === "https:" ? new https.Agent({
    ca,
    cert,
    key,
    keepAlive: true,
    rejectUnauthorized,
  }) : undefined;

  return async <T>(method: string, path: string, payload?: unknown): Promise<T> => {
    const url = new URL(path, baseUrl);
    const body = payload !== undefined ? JSON.stringify(payload) : undefined;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (body) headers["content-length"] = Buffer.byteLength(body).toString();

    const options: https.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      path: url.pathname + url.search,
      headers,
      timeout: timeoutMs,
    };

    if (url.protocol === "https:" && agent) {
      options.agent = agent;
    }

    const transport = url.protocol === "https:" ? https : http;

    return await new Promise<T>((resolve, reject) => {
      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) {
            try {
              resolve((text ? JSON.parse(text) : {}) as T);
            } catch (err) {
              reject(new Error(`Failed to parse PayTo response: ${err instanceof Error ? err.message : String(err)}`));
            }
          } else {
            const error = new Error(`PayTo API ${res.statusCode}: ${text}`);
            (error as any).statusCode = res.statusCode;
            reject(error);
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error("PayTo request timed out"));
      });
      if (body) req.write(body);
      req.end();
    });
  };
}

let bankRequest: BankRequester = createBankRequester();

export function __setDb(testDb: Queryable) {
  db = testDb;
}

export function __resetDb() {
  db = new Pool();
}

export function __setBankRequester(requester: BankRequester) {
  bankRequest = requester;
}

export function __resetBankRequester() {
  bankRequest = createBankRequester();
}

interface MandateRow {
  abn: string;
  reference: string;
  bank_mandate_id: string;
  cap_cents: string | number;
  consumed_cents: string | number;
  status: string;
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadMandate(abn: string, reference: string): Promise<MandateRow | null> {
  const { rows } = await db.query(
    "SELECT abn, reference, bank_mandate_id, cap_cents, consumed_cents, status FROM payto_mandates WHERE abn=$1 AND reference=$2",
    [abn, reference]
  );
  return rows[0] || null;
}

async function upsertMandate(
  abn: string,
  reference: string,
  mandateId: string,
  capCents: number,
  status: string,
  consumedCents: number,
  lastReceiptHash: string | null,
  meta: unknown
) {
  await db.query(
    `INSERT INTO payto_mandates(abn, reference, bank_mandate_id, cap_cents, consumed_cents, status, last_receipt_hash, meta, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (bank_mandate_id) DO UPDATE
       SET cap_cents=EXCLUDED.cap_cents,
           consumed_cents=EXCLUDED.consumed_cents,
           status=EXCLUDED.status,
           last_receipt_hash=EXCLUDED.last_receipt_hash,
           meta=EXCLUDED.meta,
           updated_at=NOW()`,
    [abn, reference, mandateId, capCents, consumedCents, status, lastReceiptHash, meta]
  );
}

async function recordDebit(
  mandate: MandateRow,
  amountCents: number,
  status: "SUCCEEDED" | "FAILED",
  bankReference: string | undefined,
  receiptHash: string | undefined,
  failureReason: string | undefined,
  bankPayload: unknown
) {
  await db.query(
    `INSERT INTO payto_debits(mandate_id, abn, amount_cents, status, bank_reference, receipt_hash, failure_reason, response)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      mandate.bank_mandate_id,
      mandate.abn,
      amountCents,
      status,
      bankReference || null,
      receiptHash || null,
      failureReason || null,
      bankPayload || null,
    ]
  );

  if (status === "SUCCEEDED") {
    await db.query(
      `UPDATE payto_mandates
         SET consumed_cents = consumed_cents + $1,
             last_receipt_hash = COALESCE($2, last_receipt_hash),
             updated_at = NOW()
       WHERE bank_mandate_id=$3`,
      [amountCents, receiptHash || null, mandate.bank_mandate_id]
    );
  } else {
    await db.query(`UPDATE payto_mandates SET updated_at=NOW() WHERE bank_mandate_id=$1`, [mandate.bank_mandate_id]);
  }
}

export async function createMandate(abn: string, capCents: number, reference: string) {
  const response = await bankRequest<{ mandate_id?: string; mandateId?: string; status?: string; consumed_cents?: number }>(
    "POST",
    "/payto/mandates",
    { abn, cap_cents: capCents, reference }
  );

  const mandateId = response.mandate_id || response.mandateId;
  if (!mandateId) {
    throw new Error("Bank did not return a mandate identifier");
  }
  const status = (response.status || "PENDING").toUpperCase();
  const consumed = toNumber(response.consumed_cents);

  await upsertMandate(abn, reference, mandateId, capCents, status, consumed, null, response);

  return { status, mandateId };
}

function mapBankStatus(status: string | undefined, code: string | undefined): PayToDebitResult["status"] {
  const normalisedStatus = status ? status.toUpperCase() : "";
  const normalisedCode = code ? code.toUpperCase() : "";

  if (["ACCEPTED", "SETTLED", "SUCCESS", "OK"].includes(normalisedStatus)) return "OK";
  if (["INSUFFICIENT_FUNDS", "CAP_EXCEEDED"].includes(normalisedStatus) || normalisedCode === "INSUFFICIENT_FUNDS") {
    return "INSUFFICIENT_FUNDS";
  }
  return "BANK_ERROR";
}

export async function debit(abn: string, amountCents: number, reference: string): Promise<PayToDebitResult> {
  const mandate = await loadMandate(abn, reference);
  if (!mandate) {
    throw new Error(`No PayTo mandate registered for ${abn} (${reference})`);
  }

  if (mandate.status.toUpperCase() === "CANCELLED") {
    await recordDebit(mandate, amountCents, "FAILED", undefined, undefined, "MANDATE_CANCELLED", { error: "cancelled" });
    return {
      status: "BANK_ERROR",
      failure_reason: "MANDATE_CANCELLED",
      mandate_id: mandate.bank_mandate_id,
    };
  }

  const cap = toNumber(mandate.cap_cents);
  const consumed = toNumber(mandate.consumed_cents);
  const remaining = cap - consumed;

  if (amountCents > remaining) {
    await recordDebit(mandate, amountCents, "FAILED", undefined, undefined, "CAP_EXCEEDED", { remaining });
    return {
      status: "INSUFFICIENT_FUNDS",
      failure_reason: "CAP_EXCEEDED",
      mandate_id: mandate.bank_mandate_id,
      remainingCapCents: Math.max(remaining, 0),
    };
  }

  const bankResponse = await bankRequest<{
    status?: string;
    code?: string;
    bank_reference?: string;
    bank_ref?: string;
    receipt?: string;
    receipt_hash?: string;
    mandate_id?: string;
  }>("POST", `/payto/mandates/${encodeURIComponent(mandate.bank_mandate_id)}/debit`, {
    amount_cents: amountCents,
    reference,
  });

  const bankRef = bankResponse.bank_reference || bankResponse.bank_ref;
  const receipt = bankResponse.receipt;
  const receiptHash = bankResponse.receipt_hash || (receipt ? sha256Hex(receipt) : undefined);
  const resultStatus = mapBankStatus(bankResponse.status, bankResponse.code);

  if (resultStatus === "OK") {
    await recordDebit(mandate, amountCents, "SUCCEEDED", bankRef, receiptHash, undefined, bankResponse);
    return {
      status: "OK",
      bank_ref: bankRef,
      receipt_hash: receiptHash,
      mandate_id: mandate.bank_mandate_id,
      remainingCapCents: remaining - amountCents,
    };
  }

  const failureReason = bankResponse.code || bankResponse.status || "BANK_ERROR";
  await recordDebit(mandate, amountCents, "FAILED", bankRef, receiptHash, failureReason, bankResponse);

  return {
    status: resultStatus,
    bank_ref: bankRef,
    receipt_hash: receiptHash,
    mandate_id: mandate.bank_mandate_id,
    failure_reason: failureReason,
    remainingCapCents: remaining,
  };
}

export async function cancelMandate(mandateId: string) {
  const response = await bankRequest<{ status?: string }>("POST", `/payto/mandates/${encodeURIComponent(mandateId)}/cancel`, {});
  await db.query(`UPDATE payto_mandates SET status='CANCELLED', updated_at=NOW() WHERE bank_mandate_id=$1`, [mandateId]);
  return response;
}

