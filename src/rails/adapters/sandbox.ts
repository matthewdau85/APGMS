import fs from "fs";
import https from "https";
import { URL } from "url";
import { randomUUID } from "crypto";
import { BankingError, BankingPort, BpayReleaseRequest, EftReleaseRequest, ReceiptResponse, ReleaseResponse } from "../port";

type StubReceipt = {
  providerRef: string;
  paidAt: string;
  amountCents: number;
  rail: "EFT" | "BPAY";
  abn: string;
  taxType: string;
  periodId: string;
  payload: Record<string, unknown>;
};

function parseAllowList(): Set<string> {
  const raw = process.env.BANKING_ABN_ALLOWLIST || "";
  const set = new Set<string>();
  for (const token of raw.split(/[,\s]+/)) {
    const abn = token.trim();
    if (abn) set.add(abn);
  }
  return set;
}

function readFileMaybe(path?: string): Buffer | undefined {
  if (!path) return undefined;
  return fs.readFileSync(path);
}

function assertBsb(value: string) {
  if (!/^\d{6}$/.test(value)) {
    throw new BankingError(400, "INVALID_BSB");
  }
}

function assertCrn(value: string) {
  if (!/^[A-Za-z0-9]{6,18}$/.test(value)) {
    throw new BankingError(400, "INVALID_CRN");
  }
}

async function requestJson<T>(opts: {
  baseUrl: URL;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  agent: https.Agent;
}): Promise<T> {
  const { baseUrl, path, method, body, headers, agent } = opts;
  const url = new URL(path, baseUrl);
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers || {}),
  };
  if (payload) {
    requestHeaders["Content-Length"] = Buffer.byteLength(payload).toString();
  }
  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        agent,
        method,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        protocol: url.protocol,
        headers: requestHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const bodyText = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode || 500;
          if (status < 200 || status >= 300) {
            return reject(new BankingError(status, bodyText || "BANKING_HTTP_ERROR"));
          }
          if (!bodyText) {
            resolve({} as T);
            return;
          }
          try {
            resolve(JSON.parse(bodyText) as T);
          } catch (err) {
            reject(new BankingError(500, "BANKING_JSON_PARSE_ERROR"));
          }
        });
      }
    );
    req.on("error", (err) => reject(new BankingError(502, String(err))));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

class SandboxBankingPort implements BankingPort {
  private readonly allowList = parseAllowList();
  private readonly baseUrl: URL | null;
  private readonly agent: https.Agent | null;
  private readonly stubByKey = new Map<string, StubReceipt>();
  private readonly stubByProvider = new Map<string, StubReceipt>();

  constructor() {
    const base = process.env.BANKING_SANDBOX_URL;
    if (base && !base.startsWith("stub")) {
      this.baseUrl = new URL(base);
      this.agent = new https.Agent({
        ca: readFileMaybe(process.env.BANK_TLS_CA),
        cert: readFileMaybe(process.env.BANK_TLS_CERT),
        key: readFileMaybe(process.env.BANK_TLS_KEY),
        rejectUnauthorized: true,
      });
    } else {
      this.baseUrl = null;
      this.agent = null;
    }
  }

  private ensureAllowListed(abn: string) {
    if (this.allowList.size === 0) {
      return;
    }
    if (!this.allowList.has(abn)) {
      throw new BankingError(400, "ABN_NOT_ALLOWLISTED");
    }
  }

  private stubRelease(req: EftReleaseRequest | BpayReleaseRequest): ReleaseResponse {
    const key = req.idempotencyKey;
    if (!key) {
      throw new BankingError(400, "MISSING_IDEMPOTENCY_KEY");
    }
    const existing = this.stubByKey.get(key);
    if (existing) {
      return { providerRef: existing.providerRef, paidAt: existing.paidAt, receipt: existing.payload };
    }
    const providerRef = `${req.rail}-${randomUUID()}`;
    const paidAt = new Date().toISOString();
    const receipt: StubReceipt = {
      providerRef,
      paidAt,
      amountCents: req.amountCents,
      rail: req.rail,
      abn: req.abn,
      taxType: req.taxType,
      periodId: req.periodId,
      payload: {
        provider_ref: providerRef,
        paid_at: paidAt,
        amount_cents: req.amountCents,
        rail: req.rail,
        metadata: req.metadata ?? {},
      },
    };
    this.stubByKey.set(key, receipt);
    this.stubByProvider.set(providerRef, receipt);
    return { providerRef, paidAt, receipt: receipt.payload };
  }

  async eftRelease(request: EftReleaseRequest): Promise<ReleaseResponse> {
    this.ensureAllowListed(request.abn);
    if (request.amountCents <= 0) {
      throw new BankingError(400, "INVALID_AMOUNT");
    }
    assertBsb(request.destination.bsb);
    if (!/^\d{5,20}$/.test(request.destination.accountNumber)) {
      throw new BankingError(400, "INVALID_ACCOUNT_NUMBER");
    }
    if (!this.baseUrl || !this.agent) {
      return this.stubRelease(request);
    }
    const response = await requestJson<{ provider_ref: string; paid_at?: string; receipt?: unknown }>(
      {
        baseUrl: this.baseUrl,
        path: "/rails/eft/release",
        method: "POST",
        body: {
          amount_cents: request.amountCents,
          destination: {
            bsb: request.destination.bsb,
            account_number: request.destination.accountNumber,
            account_name: request.destination.accountName,
            lodgement_reference: request.destination.lodgementReference,
          },
          metadata: { abn: request.abn, taxType: request.taxType, periodId: request.periodId, ...(request.metadata || {}) },
        },
        headers: {
          ...(request.headers as Record<string, string> | undefined),
          "Idempotency-Key": request.idempotencyKey,
        },
        agent: this.agent,
      }
    );
    const providerRef = response.provider_ref;
    if (!providerRef) {
      throw new BankingError(502, "MISSING_PROVIDER_REF");
    }
    return { providerRef, paidAt: response.paid_at ?? null, receipt: response.receipt };
  }

  async bpayRelease(request: BpayReleaseRequest): Promise<ReleaseResponse> {
    this.ensureAllowListed(request.abn);
    if (request.amountCents <= 0) {
      throw new BankingError(400, "INVALID_AMOUNT");
    }
    assertCrn(request.destination.crn);
    if (!/^\d{4,6}$/.test(request.destination.billerCode)) {
      throw new BankingError(400, "INVALID_BILLER_CODE");
    }
    if (!this.baseUrl || !this.agent) {
      return this.stubRelease(request);
    }
    const response = await requestJson<{ provider_ref: string; paid_at?: string; receipt?: unknown }>(
      {
        baseUrl: this.baseUrl,
        path: "/rails/bpay/release",
        method: "POST",
        body: {
          amount_cents: request.amountCents,
          destination: {
            biller_code: request.destination.billerCode,
            crn: request.destination.crn,
          },
          metadata: { abn: request.abn, taxType: request.taxType, periodId: request.periodId, ...(request.metadata || {}) },
        },
        headers: {
          ...(request.headers as Record<string, string> | undefined),
          "Idempotency-Key": request.idempotencyKey,
        },
        agent: this.agent,
      }
    );
    const providerRef = response.provider_ref;
    if (!providerRef) {
      throw new BankingError(502, "MISSING_PROVIDER_REF");
    }
    return { providerRef, paidAt: response.paid_at ?? null, receipt: response.receipt };
  }

  async fetchReceipt(providerRef: string): Promise<ReceiptResponse> {
    if (!providerRef) {
      throw new BankingError(400, "MISSING_PROVIDER_REF");
    }
    if (!this.baseUrl || !this.agent) {
      const existing = this.stubByProvider.get(providerRef);
      if (!existing) {
        throw new BankingError(404, "RECEIPT_NOT_FOUND");
      }
      return {
        providerRef,
        paidAt: existing.paidAt,
        amountCents: existing.amountCents,
        rail: existing.rail,
        raw: existing.payload,
      };
    }
    const response = await requestJson<{ provider_ref: string; paid_at?: string; amount_cents?: number; rail?: string; receipt?: unknown }>(
      {
        baseUrl: this.baseUrl,
        path: `/rails/receipts/${encodeURIComponent(providerRef)}`,
        method: "GET",
        agent: this.agent,
      }
    );
    return {
      providerRef: response.provider_ref || providerRef,
      paidAt: response.paid_at ?? null,
      amountCents: response.amount_cents,
      rail: (response.rail as "EFT" | "BPAY" | undefined) ?? undefined,
      raw: response.receipt ?? response,
    };
  }
}

export const sandboxBankingPort: BankingPort = new SandboxBankingPort();
