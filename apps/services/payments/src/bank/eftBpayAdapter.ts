import https from "https";
import axios from "axios";
import { createHash, randomUUID } from "crypto";
import { normalizeSchemaVersion, SchemaVersion } from "../utils/schemaVersion.js";

export type BankTransferParams = {
  abn: string; taxType: string; periodId: string;
  amount_cents: number;
  destination: { bpay_biller?: string; crn?: string; bsb?: string; acct?: string };
  idempotencyKey: string;
  schema_version?: string;
};

export type BankTransferPayload = {
  schema_version: SchemaVersion;
  amount_cents: number;
  meta: { abn: string; taxType: string; periodId: string; transfer_uuid: string; schema_version: SchemaVersion };
  destination: { bpay_biller?: string; crn?: string; bsb?: string; acct?: string };
};

export function buildBankTransferPayload(p: BankTransferParams, transferUuid: string): { schemaVersion: SchemaVersion; payload: BankTransferPayload } {
  const schemaVersion = normalizeSchemaVersion(p.schema_version);
  return {
    schemaVersion,
    payload: {
      schema_version: schemaVersion,
      amount_cents: p.amount_cents,
      meta: { abn: p.abn, taxType: p.taxType, periodId: p.periodId, transfer_uuid: transferUuid, schema_version: schemaVersion },
      destination: p.destination,
    },
  };
}

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

export async function sendEftOrBpay(p: BankTransferParams): Promise<{schema_version: SchemaVersion; transfer_uuid: string; bank_receipt_hash: string; provider_receipt_id: string}> {
  const transfer_uuid = randomUUID();
  const { schemaVersion, payload } = buildBankTransferPayload(p, transfer_uuid);

  const headers = { "Idempotency-Key": p.idempotencyKey };
  const maxAttempts = 3;
  let attempt = 0, lastErr: any;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const r = await client.post("/payments/eft-bpay", payload, { headers });
      const receipt = r.data?.receipt_id || "";
      const hash = createHash("sha256").update(receipt).digest("hex");
      return { schema_version: schemaVersion, transfer_uuid, bank_receipt_hash: hash, provider_receipt_id: receipt };
    } catch (e: any) {
      lastErr = e;
      await new Promise(s => setTimeout(s, attempt * 250));
    }
  }
  throw new Error("Bank transfer failed: " + String(lastErr?.message || lastErr));
}
