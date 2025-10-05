import pg from "pg";
import axios from "axios";
import https from "https";
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

export async function createMandate(abn: string, periodId: string, cap_cents: number) {
  const r = await client.post("/payto/mandates", { abn, periodId, cap_cents });
  return r.data;
}
export async function verifyMandate(mandate_id: string) {
  const r = await client.post(`/payto/mandates/${mandate_id}/verify`, {});
  return r.data;
}
export async function debitMandate(mandate_id: string, amount_cents: number, meta: any) {
  const r = await client.post(`/payto/mandates/${mandate_id}/debit`, { amount_cents, meta });
  return r.data;
}
export async function cancelMandate(mandate_id: string) {
  const r = await client.post(`/payto/mandates/${mandate_id}/cancel`, {});
  return r.data;
}
