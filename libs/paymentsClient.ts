// libs/paymentsClient.ts
type Common = { abn: string; taxType: string; periodId: string };
export type DepositArgs = Common & { amountCents: number };   // > 0
export type ReleaseArgs = Common & { amountCents: number };   // < 0

function resolveBase() {
  const envBase =
    process.env.NEXT_PUBLIC_PAYMENTS_BASE_URL ||
    process.env.PAYMENTS_BASE_URL;

  if (envBase && envBase.trim()) {
    return envBase.trim();
  }

  if (typeof window !== "undefined") {
    return "/api"; // same-origin proxy from the browser
  }

  return "http://localhost:3001"; // default for server-side usage
}

function buildUrl(path: string, params?: Record<string, string | number | boolean>) {
  const base = resolveBase().replace(/\/$/, "");
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;
  const absolute = /^https?:\/\//i.test(base);
  const url = absolute
    ? new URL(`${base}${normalisedPath}`)
    : new URL(`${base}${normalisedPath}`, "http://placeholder.local");

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return absolute ? url.toString() : `${url.pathname}${url.search}`;
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
    const res = await fetch(buildUrl("/deposit"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    return handle(res);
  },
  async payAto(args: ReleaseArgs) {
    const res = await fetch(buildUrl("/payAto"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    return handle(res);
  },
  async balance(q: Common) {
    const res = await fetch(buildUrl("/balance", q));
    return handle(res);
  },
  async ledger(q: Common) {
    const res = await fetch(buildUrl("/ledger", q));
    return handle(res);
  },
  async evidence(q: Common) {
    const res = await fetch(buildUrl("/evidence", q));
    return handle(res);
  },
};
