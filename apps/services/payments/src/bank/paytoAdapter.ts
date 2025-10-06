import axios from "axios";
import https from "https";
import { getMockBanking } from "../sim/bank/MockBanking.js";

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

export async function createMandate(abn: string, periodId: string, cap_cents: number) {
  if (useMockBank()) {
    const mock = getMockBanking();
    return mock.createMandate(abn, periodId, cap_cents);
  }
  const r = await client.post("/payto/mandates", { abn, periodId, cap_cents });
  return r.data;
}

export async function verifyMandate(mandate_id: string) {
  if (useMockBank()) {
    const mock = getMockBanking();
    return mock.verifyMandate(mandate_id);
  }
  const r = await client.post(`/payto/mandates/${mandate_id}/verify`, {});
  return r.data;
}

export async function debitMandate(mandate_id: string, amount_cents: number, meta: any) {
  if (useMockBank()) {
    const mock = getMockBanking();
    return mock.debitMandate(mandate_id, amount_cents, meta);
  }
  const r = await client.post(`/payto/mandates/${mandate_id}/debit`, { amount_cents, meta });
  return r.data;
}

export async function cancelMandate(mandate_id: string) {
  if (useMockBank()) {
    const mock = getMockBanking();
    return mock.cancelMandate(mandate_id);
  }
  const r = await client.post(`/payto/mandates/${mandate_id}/cancel`, {});
  return r.data;
}
