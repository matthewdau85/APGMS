import https from "https";
import fs from "fs";
import axios, { AxiosInstance } from "axios";
import { createHash, randomUUID } from "crypto";
import {
  BankEgressPort,
  BankTransferParams,
  BankTransferResult,
  PayToDebitParams,
  PayToMandateParams
} from "@core/ports";

function buildHttpsAgent(): https.Agent {
  const ca = process.env.BANK_TLS_CA ? fs.readFileSync(process.env.BANK_TLS_CA) : undefined;
  const cert = process.env.BANK_TLS_CERT ? fs.readFileSync(process.env.BANK_TLS_CERT) : undefined;
  const key = process.env.BANK_TLS_KEY ? fs.readFileSync(process.env.BANK_TLS_KEY) : undefined;

  return new https.Agent({
    ca,
    cert,
    key,
    rejectUnauthorized: true
  });
}

function buildClient(): AxiosInstance {
  const baseURL = process.env.BANK_API_BASE;
  if (!baseURL) {
    throw new Error("BANK_API_BASE is required when using the real bank provider");
  }
  return axios.create({
    baseURL,
    timeout: Number(process.env.BANK_TIMEOUT_MS ?? "8000"),
    httpsAgent: buildHttpsAgent()
  });
}

class RealBankEgressPort implements BankEgressPort {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = buildClient();
  }

  getCapabilities(): string[] {
    return ["real", "eft-bpay", "payto"];
  }

  async sendEftOrBpay(params: BankTransferParams): Promise<BankTransferResult> {
    const transferUuid = randomUUID();
    const payload = {
      amount_cents: params.amountCents,
      meta: {
        abn: params.abn,
        taxType: params.taxType,
        periodId: params.periodId,
        transfer_uuid: transferUuid
      },
      destination: params.destination
    };

    const headers = { "Idempotency-Key": params.idempotencyKey };
    const { data } = await this.client.post("/payments/eft-bpay", payload, { headers });
    const providerReceiptId: string = data?.receipt_id ?? "";
    const bankReceiptHash = createHash("sha256").update(providerReceiptId).digest("hex");
    return { transferUuid, bankReceiptHash, providerReceiptId };
  }

  async createMandate(params: PayToMandateParams): Promise<unknown> {
    const { data } = await this.client.post("/payto/mandates", {
      abn: params.abn,
      periodId: params.periodId,
      cap_cents: params.capCents
    });
    return data;
  }

  async verifyMandate(mandateId: string): Promise<unknown> {
    const { data } = await this.client.post(`/payto/mandates/${mandateId}/verify`, {});
    return data;
  }

  async debitMandate(params: PayToDebitParams): Promise<unknown> {
    const { data } = await this.client.post(`/payto/mandates/${params.mandateId}/debit`, {
      amount_cents: params.amountCents,
      meta: params.metadata
    });
    return data;
  }

  async cancelMandate(mandateId: string): Promise<unknown> {
    const { data } = await this.client.post(`/payto/mandates/${mandateId}/cancel`, {});
    return data;
  }
}

export function createRealBankEgressPort(): BankEgressPort {
  return new RealBankEgressPort();
}
