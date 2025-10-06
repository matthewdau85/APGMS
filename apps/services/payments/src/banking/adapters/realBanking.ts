import axios, { AxiosInstance } from "axios";
import https from "https";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  BankingPort,
  BankingResult,
  EftRequest,
  BpayRequest,
  PayToSweepRequest,
} from "../index.js";

function buildHttpsAgent(): https.Agent | undefined {
  if ((process.env.FEATURE_MTLS ?? "false").toLowerCase() !== "true") {
    return undefined;
  }
  const cert = process.env.BANK_TLS_CERT ? fs.readFileSync(process.env.BANK_TLS_CERT) : undefined;
  const key = process.env.BANK_TLS_KEY ? fs.readFileSync(process.env.BANK_TLS_KEY) : undefined;
  const ca = process.env.BANK_TLS_CA ? fs.readFileSync(process.env.BANK_TLS_CA) : undefined;
  if (!cert || !key) {
    throw new Error("FEATURE_MTLS enabled but BANK_TLS_CERT/BANK_TLS_KEY not configured");
  }
  return new https.Agent({ cert, key, ca, rejectUnauthorized: true });
}

function createClient(): AxiosInstance {
  const baseURL = process.env.BANK_API_BASE;
  if (!baseURL) {
    throw new Error("BANK_API_BASE is required for real banking adapter");
  }
  return axios.create({
    baseURL,
    timeout: Number(process.env.BANK_TIMEOUT_MS ?? "8000"),
    httpsAgent: buildHttpsAgent(),
  });
}

async function postPayment<TPayload>(client: AxiosInstance, path: string, payload: TPayload, idempotencyKey: string) {
  const headers = { "Idempotency-Key": idempotencyKey };
  const response = await client.post(path, payload, { headers });
  const data = response.data ?? {};
  const providerRef = data.provider_ref ?? data.provider_reference ?? data.receipt_id ?? data.id ?? randomUUID();
  const transferUuid = data.transfer_uuid ?? (payload as any)?.meta?.transfer_uuid ?? randomUUID();
  return { providerRef: String(providerRef), transferUuid: String(transferUuid) } satisfies BankingResult;
}

let singletonClient: AxiosInstance | undefined;
function getClient(): AxiosInstance {
  if (!singletonClient) {
    singletonClient = createClient();
  }
  return singletonClient;
}

export const realBankingPort: BankingPort = {
  async eft(request: EftRequest): Promise<BankingResult> {
    const payload = {
      amount_cents: request.amountCents,
      destination: {
        bsb: request.bsb,
        account_number: request.accountNumber,
        lodgement_reference: request.lodgementReference,
      },
      meta: {
        abn: request.abn,
        tax_type: request.taxType,
        period_id: request.periodId,
        transfer_uuid: request.transferUuid,
      },
    };
    return postPayment(getClient(), "/payments/eft", payload, request.idempotencyKey);
  },

  async bpay(request: BpayRequest): Promise<BankingResult> {
    const payload = {
      amount_cents: request.amountCents,
      destination: {
        biller_code: request.billerCode,
        crn: request.crn,
      },
      meta: {
        abn: request.abn,
        tax_type: request.taxType,
        period_id: request.periodId,
        transfer_uuid: request.transferUuid,
      },
    };
    return postPayment(getClient(), "/payments/bpay", payload, request.idempotencyKey);
  },

  async payToSweep(request: PayToSweepRequest): Promise<BankingResult> {
    const payload = {
      amount_cents: request.amountCents,
      sweep_id: request.sweepId,
      meta: {
        abn: request.abn,
        tax_type: request.taxType,
        period_id: request.periodId,
        transfer_uuid: request.transferUuid,
      },
    };
    return postPayment(getClient(), "/payments/payto/sweeps", payload, request.idempotencyKey);
  },
};
