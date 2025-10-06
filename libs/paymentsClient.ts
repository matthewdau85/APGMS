// libs/paymentsClient.ts
type Common = { abn: string; taxType: string; periodId: string };
export type DepositArgs = Common & { amountCents: number };   // > 0
export type ReleaseArgs = Common & { amountCents: number };   // < 0
type RequestOptions = { headers?: Record<string, string | undefined> };

// Prefer NEXT_PUBLIC_ (browser-safe), then server-only, then default
const BASE =
  process.env.NEXT_PUBLIC_PAYMENTS_BASE_URL ||
  process.env.PAYMENTS_BASE_URL ||
  "http://localhost:3000";

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

function mergeHeaders(base: Record<string, string>, extra?: Record<string, string | undefined>) {
  if (!extra) return base;
  const merged: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (v != null) merged[k] = v;
  }
  return merged;
}

export const Payments = {
  async deposit(args: DepositArgs, options?: RequestOptions) {
    const res = await fetch(`${BASE}/deposit`, {
      method: "POST",
      headers: mergeHeaders({ "content-type": "application/json" }, options?.headers),
      body: JSON.stringify(args),
    });
    return handle(res);
  },
  async payAto(args: ReleaseArgs, options?: RequestOptions) {
    const res = await fetch(`${BASE}/payAto`, {
      method: "POST",
      headers: mergeHeaders({ "content-type": "application/json" }, options?.headers),
      body: JSON.stringify(args),
    });
    return handle(res);
  },
  async balance(q: Common, options?: RequestOptions) {
    const u = new URL(`${BASE}/balance`);
    Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const res = await fetch(u, { headers: mergeHeaders({}, options?.headers) });
    return handle(res);
  },
  async ledger(q: Common, options?: RequestOptions) {
    const u = new URL(`${BASE}/ledger`);
    Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const res = await fetch(u, { headers: mergeHeaders({}, options?.headers) });
    return handle(res);
  },
};
