import axios from "axios";
import { createHash, randomUUID } from "crypto";

type PayToParams = {
  abn: string;
  amount_cents: number;
  reference: string;
  idempotencyKey: string;
};

const client = axios.create({
  baseURL: process.env.PAYTO_API_BASE,
  timeout: Number(process.env.PAYTO_TIMEOUT_MS || "8000")
});

export async function sendPayToDebit(p: PayToParams) {
  const transfer_uuid = randomUUID();
  const payload = {
    amount_cents: p.amount_cents,
    meta: { abn: p.abn, reference: p.reference, transfer_uuid }
  };
  const headers = { "Idempotency-Key": p.idempotencyKey };

  const r = await client.post("/payto/debit", payload, { headers });
  const receipt = r.data?.receipt_id || "";
  const hash = createHash("sha256").update(receipt).digest("hex");
  return { transfer_uuid, bank_receipt_hash: hash, provider_receipt_id: receipt };
}
