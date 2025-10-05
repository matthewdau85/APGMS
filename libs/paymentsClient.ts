// libs/paymentsClient.ts
type Common = { abn: string; taxType: string; periodId: string };
export type DepositArgs = Common & { amountCents: number };   // > 0
export type ReleaseArgs = Common & { amountCents: number };   // < 0

type ClientConfig = {
  baseUrl?: string;
  routes?: Partial<Record<"deposit" | "payAto" | "balance" | "ledger" | "evidence", string>>;
};

// Prefer NEXT_PUBLIC_ (browser-safe), then server-only, then default
const DEFAULT_BASE =
  process.env.NEXT_PUBLIC_PAYMENTS_BASE_URL ||
  process.env.PAYMENTS_BASE_URL ||
  "http://localhost:3001";

function joinUrl(base: string, path: string) {
  const trimmedBase = base.replace(/\/$/, "");
  const trimmedPath = path.replace(/^\//, "");
  if (!trimmedBase) return `/${trimmedPath}`;
  return `${trimmedBase}/${trimmedPath}`;
}

function withQuery(url: string, q: Common) {
  const params = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => params.set(k, String(v)));
  const suffix = params.toString();
  return suffix ? `${url}?${suffix}` : url;
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

export function createPaymentsClient(config: ClientConfig = {}) {
  const base = config.baseUrl ?? DEFAULT_BASE;
  const routes = {
    deposit: config.routes?.deposit ?? "/deposit",
    payAto: config.routes?.payAto ?? "/payAto",
    balance: config.routes?.balance ?? "/balance",
    ledger: config.routes?.ledger ?? "/ledger",
    evidence: config.routes?.evidence ?? "/evidence",
  } as const;
  return {
    async deposit(args: DepositArgs) {
      const res = await fetch(joinUrl(base, routes.deposit), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      return handle(res);
    },
    async payAto(args: ReleaseArgs) {
      const res = await fetch(joinUrl(base, routes.payAto), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      return handle(res);
    },
    async balance(q: Common) {
      const res = await fetch(withQuery(joinUrl(base, routes.balance), q));
      return handle(res);
    },
    async ledger(q: Common) {
      const res = await fetch(withQuery(joinUrl(base, routes.ledger), q));
      return handle(res);
    },
    async evidence(q: Common) {
      const res = await fetch(withQuery(joinUrl(base, routes.evidence), q));
      return handle(res);
    },
  };
}

export const Payments = createPaymentsClient();
