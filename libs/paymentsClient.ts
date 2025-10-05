// libs/paymentsClient.ts
import { withRequestId } from "../src/http/outbound";

type Common = { abn: string; taxType: string; periodId: string };
export type DepositArgs = Common & { amountCents: number };   // > 0
export type ReleaseArgs = Common & { amountCents: number };   // < 0

// Prefer NEXT_PUBLIC_ (browser-safe), then server-only, then default
const BASE =
  process.env.NEXT_PUBLIC_PAYMENTS_BASE_URL ||
  process.env.PAYMENTS_BASE_URL ||
  "http://localhost:3001";

type RequestContext = { req?: Parameters<typeof withRequestId>[0] };

function withOutboundContext<T extends { headers?: Record<string, string> }>(
  ctx: RequestContext | undefined,
  init: T,
) {
  return withRequestId(ctx?.req, init);
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
  async deposit(args: DepositArgs, ctx?: RequestContext) {
    const init = withOutboundContext(ctx, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const res = await fetch(`${BASE}/deposit`, init);
    return handle(res);
  },
  async payAto(args: ReleaseArgs, ctx?: RequestContext) {
    const init = withOutboundContext(ctx, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const res = await fetch(`${BASE}/payAto`, init);
    return handle(res);
  },
  async balance(q: Common, ctx?: RequestContext) {
    const u = new URL(`${BASE}/balance`);
    Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const init = withOutboundContext(ctx, {});
    const res = await fetch(u, init);
    return handle(res);
  },
  async ledger(q: Common, ctx?: RequestContext) {
    const u = new URL(`${BASE}/ledger`);
    Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const init = withOutboundContext(ctx, {});
    const res = await fetch(u, init);
    return handle(res);
  },
};
