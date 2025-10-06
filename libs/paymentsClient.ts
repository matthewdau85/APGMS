// libs/paymentsClient.ts
import { getCurrentRequestId } from "./observability/index.js";

type Common = { abn: string; taxType: string; periodId: string };
export type DepositArgs = Common & { amountCents: number };   // > 0
export type ReleaseArgs = Common & { amountCents: number };   // < 0

// Prefer NEXT_PUBLIC_ (browser-safe), then server-only, then default
const BASE =
  process.env.NEXT_PUBLIC_PAYMENTS_BASE_URL ||
  process.env.PAYMENTS_BASE_URL ||
  "http://localhost:3001";

function withRequestHeaders(init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const requestId = getCurrentRequestId();
  if (requestId) {
    headers.set("x-request-id", requestId);
  }
  return { ...init, headers } satisfies RequestInit;
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
    const res = await fetch(
      `${BASE}/deposit`,
      withRequestHeaders({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      })
    );
    return handle(res);
  },
  async payAto(args: ReleaseArgs) {
    const res = await fetch(
      `${BASE}/payAto`,
      withRequestHeaders({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      })
    );
    return handle(res);
  },
  async balance(q: Common) {
    const u = new URL(`${BASE}/balance`);
    Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const res = await fetch(u, withRequestHeaders());
    return handle(res);
  },
  async ledger(q: Common) {
    const u = new URL(`${BASE}/ledger`);
    Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const res = await fetch(u, withRequestHeaders());
    return handle(res);
  },
};
