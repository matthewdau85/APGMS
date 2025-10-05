export type RemittanceFailureReason = "shortfall" | "anomaly";

export type RemittanceResult = {
  ok: boolean;
  reason?: RemittanceFailureReason;
  message?: string;
  paygwBalance?: number;
  gstBalance?: number;
};

type BalanceResponse = {
  balance_cents: number;
  has_release: boolean;
};

function resolvePaymentsBase(): string {
  const raw = process.env.NEXT_PUBLIC_PAYMENTS_PROXY_BASE || "/api";
  if (/^https?:/i.test(raw)) {
    return raw.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location) {
    const prefix = raw.startsWith("/") ? raw : `/${raw}`;
    return `${window.location.origin}${prefix}`.replace(/\/$/, "");
  }
  const fallback = process.env.PAYMENTS_BASE_URL || "http://localhost:3000";
  const prefix = raw.startsWith("/") ? raw : `/${raw}`;
  return `${fallback.replace(/\/$/, "")}${prefix}`.replace(/\/$/, "");
}

const PAYMENTS_API_BASE = resolvePaymentsBase();
const DEMO_ABN = (process.env.NEXT_PUBLIC_DEMO_ABN || "12345678901").replace(/\s+/g, "");
const DEFAULT_PERIOD_ID = process.env.NEXT_PUBLIC_DEMO_PERIOD_ID || new Date().toISOString().slice(0, 7);

function formatDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

async function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_err) {
    json = null;
  }
  if (!response.ok) {
    const message = json?.error || json?.detail || text || response.statusText;
    throw new Error(message);
  }
  return json;
}

async function getBalance(taxType: "PAYGW" | "GST"): Promise<BalanceResponse> {
  const query = new URLSearchParams({
    abn: DEMO_ABN,
    taxType,
    periodId: DEFAULT_PERIOD_ID,
  });
  const url = `${PAYMENTS_API_BASE}/balance?${query.toString()}`;
  const data = await fetchJson(url);
  return {
    balance_cents: Number(data?.balance_cents ?? 0),
    has_release: Boolean(data?.has_release),
  };
}

class RemittanceError extends Error {
  reason: RemittanceFailureReason;

  constructor(reason: RemittanceFailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export async function submitSTPReport(data: any): Promise<boolean> {
  console.log("Submitting STP report to ATO:", data);
  return true;
}

export async function signTransaction(amount: number, account: string): Promise<string> {
  return `SIGNED-${amount}-${account}-${Date.now()}`;
}

export async function transferToOneWayAccount(amount: number, from: string, to: string): Promise<boolean> {
  const signature = await signTransaction(amount, to);
  console.log(`Transfer $${amount} from ${from} to ${to} [${signature}]`);
  return true;
}

export async function verifyFunds(paygwDue: number, gstDue: number): Promise<RemittanceResult> {
  try {
    const [paygw, gst] = await Promise.all([
      getBalance("PAYGW"),
      getBalance("GST"),
    ]);

    const paygwDueCents = Math.round(paygwDue * 100);
    const gstDueCents = Math.round(gstDue * 100);

    const anomalyTypes: string[] = [];
    if (paygw.has_release) anomalyTypes.push("PAYGW");
    if (gst.has_release) anomalyTypes.push("GST");
    if (anomalyTypes.length) {
      const message = `${anomalyTypes.join(" & ")} period already released — investigate before re-lodging.`;
      return {
        ok: false,
        reason: "anomaly",
        message,
        paygwBalance: paygw.balance_cents / 100,
        gstBalance: gst.balance_cents / 100,
      };
    }

    const shortfalls: { type: "PAYGW" | "GST"; due: number; held: number }[] = [];
    if (paygwDueCents > paygw.balance_cents) {
      shortfalls.push({ type: "PAYGW", due: paygwDueCents, held: paygw.balance_cents });
    }
    if (gstDueCents > gst.balance_cents) {
      shortfalls.push({ type: "GST", due: gstDueCents, held: gst.balance_cents });
    }

    if (shortfalls.length) {
      const details = shortfalls
        .map((s) => {
          const shortfall = s.due - s.held;
          return `${s.type} shortfall $${formatDollars(shortfall)} (held $${formatDollars(s.held)} vs due $${formatDollars(s.due)})`;
        })
        .join("; ");
      return {
        ok: false,
        reason: "shortfall",
        message: details,
        paygwBalance: paygw.balance_cents / 100,
        gstBalance: gst.balance_cents / 100,
      };
    }

    return {
      ok: true,
      message: "Sufficient funds reserved in OWA.",
      paygwBalance: paygw.balance_cents / 100,
      gstBalance: gst.balance_cents / 100,
    };
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "anomaly",
      message: `Payments service error: ${message}`,
    };
  }
}

async function releaseFunds(taxType: "PAYGW" | "GST", due: number) {
  if (due <= 0) return;
  const amountCents = -Math.round(due * 100);
  const body = JSON.stringify({
    abn: DEMO_ABN,
    taxType,
    periodId: DEFAULT_PERIOD_ID,
    amountCents,
  });
  try {
    await fetchJson(`${PAYMENTS_API_BASE}/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RemittanceError("anomaly", message);
  }
}

export async function initiateTransfer(paygwDue: number, gstDue: number): Promise<RemittanceResult> {
  try {
    await releaseFunds("PAYGW", paygwDue);
    await releaseFunds("GST", gstDue);
    return {
      ok: true,
      message: "Release instructions accepted by payments service.",
    };
  } catch (error: any) {
    if (error instanceof RemittanceError) {
      return { ok: false, reason: error.reason, message: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "anomaly", message };
  }
}
