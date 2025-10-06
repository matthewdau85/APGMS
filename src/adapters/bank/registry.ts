import { createHash } from "crypto";
import { readFileSync } from "fs";
import http from "http";
import https from "https";
import { URL } from "url";

import type { Rail } from "../../rails/adapter";

export interface BankTransferDestination {
  bsb?: string | null;
  acct?: string | null;
  bpay_biller?: string | null;
  crn?: string | null;
  reference?: string | null;
}

export interface BankTransferRequest {
  tenant?: string;
  rail: Rail;
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  reference: string;
  destination: BankTransferDestination;
  idempotencyKey: string;
}

export interface BankTransferResult {
  bank_receipt_hash: string;
  provider_receipt_id: string;
}

interface Adapter {
  rail: Rail;
  tenant: string;
  baseUrl: string;
  timeoutMs: number;
  agent?: https.Agent;
}

const adapters = new Map<string, Adapter>();

function key(rail: Rail, tenant: string) {
  return `${tenant}:${rail}`;
}

function parseRails(env?: string): Rail[] {
  const fallback: Rail[] = ["EFT", "BPAY"];
  if (!env) return fallback;
  const rails = env
    .split(",")
    .map(r => r.trim().toUpperCase())
    .filter(r => r === "EFT" || r === "BPAY") as Rail[];
  return rails.length ? rails : fallback;
}

function toAgent(prefix: string): https.Agent | undefined {
  const caPath = process.env[`${prefix}_CA`];
  const certPath = process.env[`${prefix}_CERT`];
  const keyPath = process.env[`${prefix}_KEY`];
  if (!caPath && !certPath && !keyPath) {
    return undefined;
  }
  return new https.Agent({
    ca: caPath ? readFileSync(caPath) : undefined,
    cert: certPath ? readFileSync(certPath) : undefined,
    key: keyPath ? readFileSync(keyPath) : undefined,
    rejectUnauthorized: true
  });
}

function registerRails(params: { baseUrl: string; tenant: string; timeoutMs: number; agent?: https.Agent; rails: Rail[] }) {
  const { baseUrl, tenant, timeoutMs, agent, rails } = params;
  rails.forEach(rail => {
    adapters.set(key(rail, tenant), { rail, tenant, baseUrl, timeoutMs, agent });
  });
}

(function bootstrap() {
  const primaryBase = process.env.BANK_API_BASE;
  if (primaryBase) {
    registerRails({
      baseUrl: primaryBase,
      tenant: "primary",
      timeoutMs: Number(process.env.BANK_TIMEOUT_MS || "8000"),
      agent: toAgent("BANK_TLS"),
      rails: parseRails(process.env.BANK_PRIMARY_RAILS)
    });
  }
  const secondEnabled = String(process.env.FEATURE_BANKING_SECOND || "").toLowerCase() === "true";
  if (secondEnabled) {
    const secondBase = process.env.BANK_SECOND_API_BASE || process.env.BANK2_API_BASE;
    if (secondBase) {
      registerRails({
        baseUrl: secondBase,
        tenant: process.env.BANK_SECOND_TENANT || "secondary",
        timeoutMs: Number(process.env.BANK_SECOND_TIMEOUT_MS || process.env.BANK_TIMEOUT_MS || "8000"),
        agent: toAgent("BANK_SECOND_TLS"),
        rails: parseRails(process.env.BANK_SECOND_RAILS)
      });
    }
  }
})();

function ensureAdapter(rail: Rail, tenant: string): Adapter {
  const adapter = adapters.get(key(rail, tenant));
  if (!adapter) {
    throw new Error(`BANK_ADAPTER_MISSING:${tenant}:${rail}`);
  }
  return adapter;
}

function httpJson(url: URL, body: unknown, options: { headers: Record<string, string>; timeoutMs: number; agent?: https.Agent }) {
  return new Promise<any>((resolve, reject) => {
    const payload = JSON.stringify(body ?? {});
    const headers = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload).toString(),
      ...options.headers
    };
    const requestOptions: https.RequestOptions = {
      method: "POST",
      headers,
      agent: options.agent
    };
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, requestOptions, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`BANK_HTTP_${res.statusCode}: ${raw || ""}`));
        }
        if (!raw) {
          return resolve({});
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve({ raw });
        }
      });
    });
    req.on("error", reject);
    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new Error("BANK_TIMEOUT"));
      });
    }
    req.write(payload);
    req.end();
  });
}

export async function sendBankTransfer(request: BankTransferRequest): Promise<BankTransferResult> {
  const tenant = (request.tenant || "primary").toString();
  const adapter = ensureAdapter(request.rail, tenant);
  const endpoint = new URL("/payments/eft-bpay", adapter.baseUrl);
  const response = await httpJson(endpoint, {
    amount_cents: request.amountCents,
    meta: {
      abn: request.abn,
      taxType: request.taxType,
      periodId: request.periodId,
      reference: request.reference,
      tenant
    },
    destination: request.destination
  }, {
    headers: { "Idempotency-Key": request.idempotencyKey },
    timeoutMs: adapter.timeoutMs,
    agent: adapter.agent
  });

  const receipt = String(
    response?.receipt_id ??
      response?.id ??
      response?.receipt ??
      response?.bank_receipt ??
      request.idempotencyKey
  );
  return {
    bank_receipt_hash: createHash("sha256").update(receipt).digest("hex"),
    provider_receipt_id: receipt
  };
}
