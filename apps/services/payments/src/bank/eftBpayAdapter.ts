import https from "https";
import axios from "axios";
import { createHash, randomUUID } from "node:crypto";
import { getMockBanking } from "../sim/bank/MockBanking.js";

type Params = {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  destination: { bpay_biller?: string; crn?: string; bsb?: string; acct?: string };
  idempotencyKey: string;
};

type TransferResult = {
  transfer_uuid: string;
  bank_receipt_hash: string;
  provider_receipt_id: string;
  rail: "EFT" | "BPAY";
  paid_at?: Date;
};

const agent = new https.Agent({
  ca: process.env.BANK_TLS_CA ? require("fs").readFileSync(process.env.BANK_TLS_CA) : undefined,
  cert: process.env.BANK_TLS_CERT ? require("fs").readFileSync(process.env.BANK_TLS_CERT) : undefined,
  key: process.env.BANK_TLS_KEY ? require("fs").readFileSync(process.env.BANK_TLS_KEY) : undefined,
  rejectUnauthorized: true,
});

const client = axios.create({
  baseURL: process.env.BANK_API_BASE,
  timeout: Number(process.env.BANK_TIMEOUT_MS || "8000"),
  httpsAgent: agent,
});

function useMockBank(): boolean {
  return !process.env.BANK_API_BASE || process.env.BANK_API_BASE === "mock";
}

export async function sendEftOrBpay(p: Params): Promise<TransferResult> {
  if (useMockBank()) {
    const mock = getMockBanking();
    return mock.sendEftOrBpay(p);
  }

  const transfer_uuid = randomUUID();
  const payload = {
    amount_cents: p.amount_cents,
    meta: { abn: p.abn, taxType: p.taxType, periodId: p.periodId, transfer_uuid },
    destination: p.destination,
  };

  const headers = { "Idempotency-Key": p.idempotencyKey };
  const r = await client.post("/payments/eft-bpay", payload, { headers });
  const receipt = r.data?.receipt_id || "";
  const hash = createHash("sha256").update(receipt).digest("hex");
  const rail = p.destination?.bpay_biller ? "BPAY" : "EFT";
  return { transfer_uuid, bank_receipt_hash: hash, provider_receipt_id: receipt, rail, paid_at: new Date() };
}
