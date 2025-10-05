import axios, { AxiosInstance } from "axios";
import https from "https";
import { randomUUID, createHash } from "crypto";
import { readFileSync } from "fs";
import { Pool } from "pg";

/** PayTo BAS Sweep adapter */
export interface PayToDebitResult {
  status: "OK" | "INSUFFICIENT_FUNDS" | "BANK_ERROR";
  bank_ref?: string;
  receipt_hash?: string;
}

interface PayToClient {
  createMandate(abn: string, capCents: number, reference: string): Promise<{ status: string; mandateId: string }>;
  debit(abn: string, amountCents: number, reference: string): Promise<{ status: PayToDebitResult["status"]; receipt_id?: string; bank_ref?: string }>;
  cancelMandate(mandateId: string): Promise<{ status: string }>;
}

const pool = new Pool();

class MtlsPayToClient implements PayToClient {
  private readonly client: AxiosInstance;

  constructor() {
    const agent = new https.Agent({
      ca: process.env.BANK_TLS_CA ? readFileSync(process.env.BANK_TLS_CA) : undefined,
      cert: process.env.BANK_TLS_CERT ? readFileSync(process.env.BANK_TLS_CERT) : undefined,
      key: process.env.BANK_TLS_KEY ? readFileSync(process.env.BANK_TLS_KEY) : undefined,
      rejectUnauthorized: process.env.BANK_TLS_REJECT_UNAUTHORIZED !== "false"
    });
    const baseURL = process.env.BANK_API_BASE || "https://bank.local";
    const timeout = Number(process.env.BANK_TIMEOUT_MS || "8000");
    this.client = axios.create({ baseURL, timeout, httpsAgent: agent });
    const apiKey = process.env.BANK_API_KEY;
    if (apiKey) {
      this.client.defaults.headers.common["Authorization"] = `Bearer ${apiKey}`;
    }
  }

  async createMandate(abn: string, capCents: number, reference: string) {
    const payload = { abn, cap_cents: capCents, reference };
    const { data } = await this.client.post("/payto/mandates", payload, {
      headers: { "Idempotency-Key": randomUUID() }
    });
    return {
      status: String(data?.status || "OK"),
      mandateId: String(data?.mandate_id || data?.mandateId || "")
    };
  }

  async debit(abn: string, amountCents: number, reference: string) {
    const payload = { abn, amount_cents: amountCents, reference };
    const { data } = await this.client.post("/payto/debits", payload, {
      headers: { "Idempotency-Key": randomUUID() }
    });
    return {
      status: (data?.status || "OK") as PayToDebitResult["status"],
      receipt_id: data?.receipt_id || data?.bank_ref,
      bank_ref: data?.bank_ref
    };
  }

  async cancelMandate(mandateId: string) {
    const { data } = await this.client.post(`/payto/mandates/${mandateId}/cancel`, {}, {
      headers: { "Idempotency-Key": randomUUID() }
    });
    return { status: String(data?.status || "OK") };
  }
}

let activeClient: PayToClient | null = null;

function getClient(): PayToClient {
  if (!activeClient) activeClient = new MtlsPayToClient();
  return activeClient;
}

export function setPayToClient(client: PayToClient | null) {
  activeClient = client;
}

async function persistReceipt(params: {
  abn: string;
  amountCents: number;
  reference: string;
  bankRef: string;
  receiptHash: string;
}) {
  const metadata = { rail: "PAYTO" };
  await pool.query(
    `INSERT INTO bank_transfer_receipts (abn, rail, reference, amount_cents, provider_receipt_id, receipt_hash, metadata)
     VALUES ($1,'PAYTO',$2,$3,$4,$5,$6)
     ON CONFLICT (provider_receipt_id) DO UPDATE SET receipt_hash = EXCLUDED.receipt_hash`,
    [
      params.abn,
      params.reference,
      params.amountCents,
      params.bankRef,
      params.receiptHash,
      JSON.stringify(metadata)
    ]
  );
}

export async function createMandate(abn: string, capCents: number, reference: string) {
  return getClient().createMandate(abn, capCents, reference);
}

export async function debit(abn: string, amountCents: number, reference: string): Promise<PayToDebitResult> {
  const client = getClient();
  const res = await client.debit(abn, amountCents, reference);
  if (res.status === "OK" && res.receipt_id) {
    const bankRef = String(res.receipt_id);
    const receiptHash = createHash("sha256").update(bankRef).digest("hex");
    await persistReceipt({ abn, amountCents, reference, bankRef, receiptHash });
    return { status: res.status, bank_ref: res.bank_ref || bankRef, receipt_hash: receiptHash };
  }
  return { status: res.status, bank_ref: res.bank_ref };
}

export async function cancelMandate(mandateId: string) {
  return getClient().cancelMandate(mandateId);
}
