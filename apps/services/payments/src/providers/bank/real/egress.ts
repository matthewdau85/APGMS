import axios from "axios";
import https from "https";
import fs from "node:fs";
import { DeadLetterQueue } from "../shared/dlq.js";
import { executeWithRetry } from "../shared/retry.js";
import type { BankEgressPort, PayoutRequest, PayoutResult, PayoutResultStatus } from "../port.js";

const agent = new https.Agent({
  ca: process.env.BANK_TLS_CA ? fs.readFileSync(process.env.BANK_TLS_CA) : undefined,
  cert: process.env.BANK_TLS_CERT ? fs.readFileSync(process.env.BANK_TLS_CERT) : undefined,
  key: process.env.BANK_TLS_KEY ? fs.readFileSync(process.env.BANK_TLS_KEY) : undefined,
  rejectUnauthorized: process.env.BANK_TLS_REJECT_UNAUTHORIZED !== "false",
});

const client = axios.create({
  baseURL: process.env.BANK_API_BASE ?? "",
  timeout: Number(process.env.BANK_TIMEOUT_MS ?? "8000"),
  httpsAgent: agent,
});

function normaliseStatus(status?: string, code?: string): PayoutResultStatus {
  const values = [status, code].filter(Boolean).map(v => String(v).toUpperCase());
  if (values.some(v => v === "ACCEPTED" || v === "SETTLED" || v === "SUCCESS" || v === "APPROVED" || v === "OK")) {
    return "ACCEPTED";
  }
  if (values.some(v => v === "PENDING" || v === "PROCESSING" || v === "QUEUED" || v === "SUBMITTED" || v === "IN_PROGRESS" || v === "HELD")) {
    return "PENDING";
  }
  if (values.some(v => v === "REJECTED" || v === "DECLINED" || v === "FAILED" || v === "ERROR" || v === "NACK")) {
    return "REJECTED";
  }
  if (values.some(v => /^0+$/.test(v))) {
    return "ACCEPTED";
  }
  if (values.some(v => /01|QUE/.test(v))) {
    return "PENDING";
  }
  return "PENDING";
}

function mapResponse(data: any, request: PayoutRequest): PayoutResult {
  const status = normaliseStatus(data?.status, data?.code);
  const reference = data?.reference ?? request.reference;
  const bank_txn_id = data?.bank_txn_id ?? data?.receipt_id ?? data?.transaction_id ?? data?.id;
  return {
    status,
    provider_code: String(data?.code ?? data?.status ?? "BANK"),
    reference,
    bank_txn_id: bank_txn_id ? String(bank_txn_id) : undefined,
    raw: typeof data === "object" ? data : undefined,
  };
}

export class RealBankEgress implements BankEgressPort {
  private readonly dlq = new DeadLetterQueue({ prefix: "real-bank-egress" });

  async submitPayout(request: PayoutRequest): Promise<PayoutResult> {
    const attempts = Number(process.env.BANK_MAX_ATTEMPTS ?? "3");
    const baseDelayMs = Number(process.env.BANK_RETRY_BASE_MS ?? "250");
    try {
      return await executeWithRetry(async () => {
        if (request.rail === "PAYTO") {
          return this.submitPayTo(request);
        }
        return this.submitDirectEntry(request);
      }, { attempts, baseDelayMs, jitter: true });
    } catch (error: any) {
      await this.dlq.push({ provider: request.rail, request, error: String(error?.message ?? error) });
      throw error;
    }
  }

  private async submitDirectEntry(request: PayoutRequest): Promise<PayoutResult> {
    const destination = request.metadata?.destination ?? {};
    const payload = {
      amount_cents: request.amountCents,
      currency: request.currency ?? "AUD",
      reference: request.reference,
      destination,
      meta: {
        abn: request.abn,
        taxType: request.taxType,
        periodId: request.periodId,
        release_uuid: request.metadata?.release_uuid,
      },
    };
    const headers = { "Idempotency-Key": request.idempotencyKey };
    const response = await client.post("/payments/direct-entry", payload, { headers });
    return mapResponse(response.data, request);
  }

  private async submitPayTo(request: PayoutRequest): Promise<PayoutResult> {
    const payload = {
      amount_cents: request.amountCents,
      reference: request.reference,
      meta: {
        abn: request.abn,
        taxType: request.taxType,
        periodId: request.periodId,
        release_uuid: request.metadata?.release_uuid,
      },
    };
    const headers = { "Idempotency-Key": request.idempotencyKey };
    const response = await client.post("/payto/debits", payload, { headers });
    return mapResponse(response.data, request);
  }
}
