import https from "https";
import axios from "axios";
import { createHash, randomUUID } from "crypto";

type Params = {
  abn: string; taxType: string; periodId: string;
  amount_cents: number;
  destination: { bpay_biller?: string; crn?: string; bsb?: string; acct?: string };
  idempotencyKey: string;
};

const agent = new https.Agent({
  ca: process.env.BANK_TLS_CA ? require("fs").readFileSync(process.env.BANK_TLS_CA) : undefined,
  cert: process.env.BANK_TLS_CERT ? require("fs").readFileSync(process.env.BANK_TLS_CERT) : undefined,
  key: process.env.BANK_TLS_KEY ? require("fs").readFileSync(process.env.BANK_TLS_KEY) : undefined,
  rejectUnauthorized: true
});

const client = axios.create({
  baseURL: process.env.BANK_API_BASE,
  timeout: Number(process.env.BANK_TIMEOUT_MS || "8000"),
  httpsAgent: agent
});

export async function sendEftOrBpay(p: Params): Promise<{transfer_uuid: string; bank_receipt_hash: string; provider_receipt_id:string}> {
  const transfer_uuid = randomUUID();
  const payload = {
    amount_cents: p.amount_cents,
    meta: { abn: p.abn, taxType: p.taxType, periodId: p.periodId, transfer_uuid },
    destination: p.destination
  };

  const headers = { "Idempotency-Key": p.idempotencyKey };
  const maxAttempts = 3;
  let attempt = 0, lastErr: any;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const r = await client.post("/payments/eft-bpay", payload, { headers });
      const receipt = r.data?.receipt_id || "";
      const hash = createHash("sha256").update(receipt).digest("hex");
      return { transfer_uuid, bank_receipt_hash: hash, provider_receipt_id: receipt };
    } catch (e: any) {
      lastErr = e;
      await new Promise(s => setTimeout(s, attempt * 250));
    }
  }
  throw new Error("Bank transfer failed: " + String(lastErr?.message || lastErr));
}
