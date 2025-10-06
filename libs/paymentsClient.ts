// libs/paymentsClient.ts
type Common = { abn: string; taxType: string; periodId: string };
export type DepositArgs = Common & { amountCents: number };   // > 0
export type ReleaseArgs = Common & { amountCents: number };   // < 0
export type AmendArgs = Common & {
  domainTotals: Record<string, number>;
  submittedBy?: string;
  reason?: string;
  evidenceRef?: string;
  nextPeriodId?: string;
};

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

export const Payments = {
  async deposit(args: DepositArgs) {
    const res = await fetch(`${BASE}/deposit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    return handle(res);
  },
  async payAto(args: ReleaseArgs) {
    const res = await fetch(`${BASE}/payAto`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
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
  async amendBas(args: AmendArgs) {
    const { periodId, ...rest } = args;
    const res = await fetch(`${BASE}/bas/${encodeURIComponent(periodId)}/amend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ periodId, ...rest }),
    });
    return handle(res);
  },
};
