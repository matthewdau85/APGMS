// libs/paymentsClient.ts
type Common = { abn: string; taxType: string; periodId: string };
type Destination = { bpay_biller?: string; crn?: string; bsb?: string; acct?: string };
export type DepositArgs = Common & { amountCents: number };   // > 0
export type ReleaseArgs = Common & { amountCents: number; destination?: Destination };   // < 0

// Prefer NEXT_PUBLIC_ (browser-safe), then server-only, then default
const BASE =
  process.env.NEXT_PUBLIC_PAYMENTS_BASE_URL ||
  process.env.PAYMENTS_BASE_URL ||
  "http://localhost:3001";

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

type RequestOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export const Payments = {
  async deposit(args: DepositArgs) {
    const res = await fetch(`${BASE}/deposit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    return handle(res);
  },
  async payAto(args: ReleaseArgs, options?: RequestOptions) {
    const headers = { "content-type": "application/json", ...(options?.headers ?? {}) };
    const init: RequestInit = {
      method: "POST",
      headers,
      body: JSON.stringify(args),
    };
    if (options?.signal) init.signal = options.signal;
    const res = await fetch(`${BASE}/payAto`, init);
    return handle(res);
  },
  async balance(q: Common) {
    const u = new URL(`${BASE}/balance`);
    Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const res = await fetch(u);
    return handle(res);
  },
  async ledger(q: Common) {
    const u = new URL(`${BASE}/ledger`);
    Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const res = await fetch(u);
    return handle(res);
  },
};
