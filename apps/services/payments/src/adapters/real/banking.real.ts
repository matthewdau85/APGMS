import https from "https";
import fs from "fs";
import axios from "axios";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import type { BankingPort } from "../../ports/banking";
import { pool } from "../../index.js";

const bool = (value: string | undefined) => /^(1|true|yes)$/i.test(value ?? "");

function readOptionalFile(path?: string) {
  if (!path) return undefined;
  try {
    return fs.readFileSync(path);
  } catch (err) {
    throw new Error(`Failed to read certificate file at ${path}: ${String((err as Error).message || err)}`);
  }
}

const baseUrl = process.env.BANKING_BASE_URL || process.env.BANK_API_BASE || "";

function ensureBaseUrl() {
  if (!baseUrl) {
    throw new Error("BANKING_BASE_URL not configured");
  }
  return new URL(baseUrl);
}

async function persistIntent(params: {
  abn: string;
  rail: "EFT" | "BPAY";
  amountCents: number;
  reference?: string;
  crn?: string;
}) {
  const table = `
    CREATE TABLE IF NOT EXISTS bank_transfers (
      id uuid PRIMARY KEY,
      abn text NOT NULL,
      rail text NOT NULL,
      amount_cents bigint NOT NULL,
      reference text,
      crn text,
      status text NOT NULL,
      created_at timestamptz DEFAULT now()
    )`;
  await pool.query(table);
  const id = randomUUID();
  await pool.query(
    `INSERT INTO bank_transfers(id, abn, rail, amount_cents, reference, crn, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, params.abn, params.rail, params.amountCents, params.reference ?? null, params.crn ?? null, "DRY_RUN"]
  );
  return { id, status: "DRY_RUN" };
}

async function callBank(pathname: string, body: any) {
  const url = ensureBaseUrl();
  const agent = new https.Agent({
    cert: readOptionalFile(process.env.MTLS_CERT || process.env.BANK_TLS_CERT),
    key: readOptionalFile(process.env.MTLS_KEY || process.env.BANK_TLS_KEY),
    ca: readOptionalFile(process.env.MTLS_CA || process.env.BANK_TLS_CA),
    rejectUnauthorized: process.env.MTLS_REJECT_UNAUTHORIZED === "false" ? false : true,
  });

  const timeout = Number(process.env.BANKING_TIMEOUT_MS || process.env.BANK_TIMEOUT_MS || 10000);

  const client = axios.create({
    baseURL: url.toString().replace(/\/$/, ""),
    timeout,
    httpsAgent: agent,
    headers: { "content-type": "application/json" },
  });

  const response = await client.post(pathname, body);
  return response.data;
}

export function createRealBankingAdapter(): BankingPort {
  const dryRun = bool(process.env.DRY_RUN);

  return {
    async eft(abn, amountCents, reference) {
      if (dryRun) {
        return persistIntent({ abn, rail: "EFT", amountCents, reference });
      }
      const payload = { abn, amount_cents: amountCents, reference };
      const json = await callBank("/payments/eft", payload);
      const id = json?.id || json?.receipt_id || json?.reference || randomUUID();
      return { id, status: json?.status || "submitted" };
    },
    async bpay(abn, crn, amountCents) {
      if (dryRun) {
        return persistIntent({ abn, rail: "BPAY", amountCents, crn });
      }
      const payload = { abn, crn, amount_cents: amountCents };
      const json = await callBank("/payments/bpay", payload);
      const id = json?.id || json?.receipt_id || json?.reference || randomUUID();
      return { id, status: json?.status || "submitted" };
    },
  };
}
