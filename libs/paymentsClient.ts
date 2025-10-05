// libs/paymentsClient.ts
import { signRequest } from "./serviceSignature";

type Common = { abn: string; taxType: string; periodId: string };
export type DepositArgs = Common & { amountCents: number };   // > 0
export type ReleaseArgs = Common & { amountCents: number };   // < 0

// Prefer NEXT_PUBLIC_ (browser-safe), then server-only, then default
const BASE =
  process.env.NEXT_PUBLIC_PAYMENTS_BASE_URL ||
  process.env.PAYMENTS_BASE_URL ||
  "http://localhost:3001";

function getSigningKey() {
  const secret = process.env.SERVICE_SIGNING_KEY;
  if (!secret) throw new Error("SERVICE_SIGNING_KEY missing");
  return secret;
}

function signedInit(method: string, url: URL, body: string | null) {
  const secret = getSigningKey();
  const payload = body ?? "";
  const signature = signRequest(method, `${url.pathname}${url.search}`, payload, secret);
  const headers: Record<string, string> = {
    "x-service-signature": signature,
  };
  if (body !== null) {
    headers["content-type"] = "application/json";
  }
  return headers;
}

async function handle(res: Response) {
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!res.ok) {
    const msg = (json && (json.error || json.detail)) || text || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return json;
}

export const Payments = {
  async deposit(args: DepositArgs) {
    const url = new URL(`${BASE}/deposit`);
    const body = JSON.stringify(args);
    const res = await fetch(url, {
      method: "POST",
      headers: signedInit("POST", url, body),
      body,
    });
    return handle(res);
  },
  async payAto(args: ReleaseArgs) {
    const url = new URL(`${BASE}/payAto`);
    const body = JSON.stringify(args);
    const res = await fetch(url, {
      method: "POST",
      headers: signedInit("POST", url, body),
      body,
    });
    return handle(res);
  },
  async balance(q: Common) {
    const u = new URL(`${BASE}/balance`);
    Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const res = await fetch(u, {
      headers: signedInit("GET", u, ""),
    });
    return handle(res);
  },
  async ledger(q: Common) {
    const u = new URL(`${BASE}/ledger`);
    Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const res = await fetch(u, {
      headers: signedInit("GET", u, ""),
    });
    return handle(res);
  },
};
