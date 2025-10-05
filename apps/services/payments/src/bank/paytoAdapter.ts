import axios from "axios";
import https from "https";
import fs from "node:fs";

const realBankEnabled = String(process.env.PROTO_ENABLE_REAL_BANK || "false").toLowerCase() === "true";

const agent = realBankEnabled
  ? new https.Agent({
      ca: process.env.BANK_TLS_CA ? fs.readFileSync(process.env.BANK_TLS_CA) : undefined,
      cert: process.env.BANK_TLS_CERT ? fs.readFileSync(process.env.BANK_TLS_CERT) : undefined,
      key: process.env.BANK_TLS_KEY ? fs.readFileSync(process.env.BANK_TLS_KEY) : undefined,
      rejectUnauthorized: true,
    })
  : undefined;

const client = realBankEnabled
  ? axios.create({
      baseURL: process.env.BANK_API_BASE,
      timeout: Number(process.env.BANK_TIMEOUT_MS || "8000"),
      httpsAgent: agent,
    })
  : null;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createMandate(abn: string, periodId: string, cap_cents: number) {
  if (!realBankEnabled || !client) {
    await delay(5);
    return {
      mandate_id: `mock-${abn}-${periodId}`,
      cap_cents,
      status: "mocked",
    };
  }
  const r = await client.post("/payto/mandates", { abn, periodId, cap_cents });
  return r.data;
}

export async function verifyMandate(mandate_id: string) {
  if (!realBankEnabled || !client) {
    await delay(5);
    return { mandate_id, status: "verified-mock" };
  }
  const r = await client.post(`/payto/mandates/${mandate_id}/verify`, {});
  return r.data;
}

export async function debitMandate(mandate_id: string, amount_cents: number, meta: any) {
  if (!realBankEnabled || !client) {
    await delay(5);
    return {
      mandate_id,
      amount_cents,
      meta,
      bank_ref: `mock-payto:${mandate_id}:${amount_cents}`,
      status: "mocked",
    };
  }
  const r = await client.post(`/payto/mandates/${mandate_id}/debit`, { amount_cents, meta });
  return r.data;
}

export async function cancelMandate(mandate_id: string) {
  if (!realBankEnabled || !client) {
    await delay(5);
    return { mandate_id, status: "cancelled-mock" };
  }
  const r = await client.post(`/payto/mandates/${mandate_id}/cancel`, {});
  return r.data;
}
