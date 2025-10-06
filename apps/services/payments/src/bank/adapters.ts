import fs from "node:fs";
import https from "node:https";
import axios from "axios";
import { createHash, randomUUID } from "node:crypto";
import { Recorder } from "../sim/recorder";

export type Destination = {
  bpay_biller?: string;
  crn?: string;
  bsb?: string;
  acct?: string;
};

export type EftBpayRequest = {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  destination: Destination;
  idempotencyKey: string;
};

export type EftBpayResult = {
  transfer_uuid: string;
  bank_receipt_hash: string;
  provider_receipt_id: string;
};

export type PayToSweepRequest = {
  mandate_id: string;
  amount_cents: number;
  meta?: Record<string, unknown>;
};

const agent = new https.Agent({
  ca: process.env.BANK_TLS_CA ? fs.readFileSync(process.env.BANK_TLS_CA) : undefined,
  cert: process.env.BANK_TLS_CERT ? fs.readFileSync(process.env.BANK_TLS_CERT) : undefined,
  key: process.env.BANK_TLS_KEY ? fs.readFileSync(process.env.BANK_TLS_KEY) : undefined,
  rejectUnauthorized: true,
});

const client = axios.create({
  baseURL: process.env.BANK_API_BASE,
  timeout: Number(process.env.BANK_TIMEOUT_MS || "8000"),
  httpsAgent: agent,
});

async function sendEftOrBpay(req: EftBpayRequest): Promise<EftBpayResult> {
  const transfer_uuid = randomUUID();
  const payload = {
    amount_cents: req.amount_cents,
    meta: {
      abn: req.abn,
      taxType: req.taxType,
      periodId: req.periodId,
      transfer_uuid,
    },
    destination: req.destination,
  };

  const headers = { "Idempotency-Key": req.idempotencyKey };
  const maxAttempts = 3;
  let attempt = 0;
  let lastErr: any;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await client.post("/payments/eft-bpay", payload, { headers });
      const receipt = response.data?.receipt_id || "";
      const hash = createHash("sha256").update(receipt).digest("hex");
      return {
        transfer_uuid,
        bank_receipt_hash: hash,
        provider_receipt_id: receipt,
      };
    } catch (err: any) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }

  throw new Error("Bank transfer failed: " + String(lastErr?.message || lastErr));
}

async function debitMandateSweep(req: PayToSweepRequest) {
  const response = await client.post(`/payto/mandates/${req.mandate_id}/debit`, {
    amount_cents: req.amount_cents,
    meta: req.meta ?? {},
  });
  return response.data;
}

const raw = {
  async eft(payload: EftBpayRequest) {
    return sendEftOrBpay(payload);
  },
  async bpay(payload: EftBpayRequest) {
    return sendEftOrBpay(payload);
  },
  async payToSweep(payload: PayToSweepRequest) {
    return debitMandateSweep(payload);
  },
};

const shouldWrap = process.env.SIM_RECORD === "true" || process.env.SIM_REPLAY === "true";
const adapter = shouldWrap ? new Recorder(raw) : raw;

export function eft(payload: EftBpayRequest) {
  return adapter.eft(payload);
}

export function bpay(payload: EftBpayRequest) {
  return adapter.bpay(payload);
}

export function payToSweep(payload: PayToSweepRequest) {
  return adapter.payToSweep(payload);
}

export type BankAdapters = typeof adapter;
