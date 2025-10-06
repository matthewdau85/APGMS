const fromEnv = () =>
  (import.meta as any)?.env?.VITE_PAYMENTS_BASE_URL ??
  (typeof process !== "undefined" ? process.env.REACT_APP_PAYMENTS_BASE_URL : undefined);

const BASE = (fromEnv() as string) || "http://localhost:3000";

async function doJson(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  if (!r.ok) throw new Error(`payments ${path} failed: ${r.status}`);
  return r.json();
}

export const paymentsApi = {
  deposit: (body: any) => doJson("/deposit", { method: "POST", body: JSON.stringify(body) }),
  balance: (abn: string) => doJson(`/balance/${abn}`),
  release: (body: any) => doJson("/release", { method: "POST", body: JSON.stringify(body) }), // keep if used
};
