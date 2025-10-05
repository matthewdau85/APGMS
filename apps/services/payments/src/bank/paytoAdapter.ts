import axios from "axios";
import { assertAllowed, mtlsAgent } from "../../../../../src/rails/client.ts";

const client = axios.create({
  baseURL: process.env.BANK_API_BASE,
  timeout: Number(process.env.BANK_TIMEOUT_MS || "8000"),
});

export async function createMandate(abn: string, periodId: string, cap_cents: number) {
  assertAllowed(abn);
  const r = await client.post("/payto/mandates", { abn, periodId, cap_cents }, { httpsAgent: mtlsAgent() });
  return r.data;
}
export async function verifyMandate(mandate_id: string) {
  const r = await client.post(`/payto/mandates/${mandate_id}/verify`, {}, { httpsAgent: mtlsAgent() });
  return r.data;
}
export async function debitMandate(mandate_id: string, amount_cents: number, meta: any) {
  const r = await client.post(`/payto/mandates/${mandate_id}/debit`, { amount_cents, meta }, { httpsAgent: mtlsAgent() });
  return r.data;
}
export async function cancelMandate(mandate_id: string) {
  const r = await client.post(`/payto/mandates/${mandate_id}/cancel`, {}, { httpsAgent: mtlsAgent() });
  return r.data;
}
