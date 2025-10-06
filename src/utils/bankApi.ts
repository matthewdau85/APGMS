import { PublicRuntimeConfig } from "./runtimeConfig";

const cryptoApi: Crypto | undefined =
  typeof globalThis !== "undefined" && (globalThis as any).crypto
    ? (globalThis as any).crypto
    : undefined;

function randomId(prefix: string): string {
  if (cryptoApi?.randomUUID) {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface BankAvailabilityResult {
  ok: boolean;
  status: number;
  availableCents?: number;
  holdCents?: number;
  traceId?: string;
  error?: string;
  code?: string;
}

export interface BankTransferResult {
  ok: boolean;
  status: number;
  transferId?: string;
  submittedAt?: string;
  receiptReference?: string;
  error?: string;
  code?: string;
}

export interface StpSubmissionResult {
  ok: boolean;
  status: number;
  reference?: string;
  lodgedAt?: string;
  error?: string;
  code?: string;
}

let runtimeConfig: PublicRuntimeConfig | null = null;

export function configureBankApi(config: PublicRuntimeConfig) {
  runtimeConfig = config;
}

function ensureConfig(): PublicRuntimeConfig {
  if (!runtimeConfig) {
    throw new Error("Bank API has not been configured. Call configureBankApi() before invoking operations.");
  }
  return runtimeConfig;
}

function sandboxAvailability(totalCents: number): BankAvailabilityResult {
  const buffer = totalCents * 2;
  return {
    ok: true,
    status: 200,
    availableCents: buffer,
    holdCents: 0,
    traceId: `sandbox-${Date.now()}`,
  };
}

async function sandboxTransfer(totalCents: number): Promise<BankTransferResult> {
  return {
    ok: true,
    status: 201,
    transferId: randomId("sandbox"),
    submittedAt: new Date().toISOString(),
    receiptReference: `VAULT-${Math.abs(totalCents)}`,
  };
}

async function sandboxStpSubmission(): Promise<StpSubmissionResult> {
  return {
    ok: true,
    status: 200,
    reference: randomId("STP").slice(0, 12),
    lodgedAt: new Date().toISOString(),
  };
}

async function createSignature(body: string): Promise<string | null> {
  const config = ensureConfig();
  const secret = (globalThis as any).__APGMS_BANKING_SECRET__ as string | undefined;
  if (!secret || !cryptoApi?.subtle) return null;
  const enc = new TextEncoder();
  const key = await cryptoApi.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await cryptoApi.subtle.sign("HMAC", key, enc.encode(body));
  const bytes = Array.from(new Uint8Array(signature));
  const binary = String.fromCharCode(...bytes);
  return btoa(binary);
}

interface BankCallInit {
  method: "GET" | "POST";
  path: string;
  payload?: unknown;
}

async function callRail<T>({ method, path, payload }: BankCallInit): Promise<{
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  code?: string;
}> {
  const config = ensureConfig();
  const baseUrl = config.banking.baseUrl;
  const body = payload !== undefined ? JSON.stringify(payload) : undefined;

  if (!baseUrl || config.flags.useMockData) {
    return {
      ok: true,
      status: 200,
      data: (payload as T) ?? ({} as T),
    };
  }

  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "X-APGMS-Rail": config.banking.rail,
    "X-APGMS-Mode": config.mode,
  };

  if (config.banking.clientId) {
    headers["X-APGMS-Client"] = config.banking.clientId;
  }

  if (body) {
    const signature = await createSignature(body);
    if (signature) {
      headers["X-APGMS-Signature"] = signature;
      if (config.banking.signingKeyId) {
        headers["X-APGMS-Key-Id"] = config.banking.signingKeyId;
      }
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body,
  });

  let data: any = undefined;
  try {
    data = await response.json();
  } catch (error) {
    // ignore body parse errors, we will surface status below
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data?.error || response.statusText,
      code: data?.code,
    };
  }

  return {
    ok: true,
    status: response.status,
    data,
  };
}

export async function verifyFunds(paygwDue: number, gstDue: number): Promise<BankAvailabilityResult> {
  const config = ensureConfig();
  const totalCents = Math.round((paygwDue + gstDue) * 100);

  if (config.flags.useMockData || !config.banking.baseUrl) {
    const sandbox = sandboxAvailability(totalCents);
    if (sandbox.availableCents !== undefined) {
      sandbox.availableCents = Math.max(sandbox.availableCents, totalCents);
    }
    return sandbox;
  }

  const result = await callRail<{
    availableCents: number;
    holdCents?: number;
    traceId?: string;
  }>({
    method: "POST",
    path: "funds/verify",
    payload: {
      totalCents,
      breakdown: {
        paygwCents: Math.round(paygwDue * 100),
        gstCents: Math.round(gstDue * 100),
      },
      requestedAt: new Date().toISOString(),
    },
  });

  if (!result.ok || !result.data) {
    return {
      ok: false,
      status: result.status,
      error: result.error ?? "Unable to verify funds",
      code: result.code,
    };
  }

  return {
    ok: true,
    status: result.status,
    availableCents: result.data.availableCents,
    holdCents: result.data.holdCents,
    traceId: result.data.traceId,
  };
}

export async function submitSTPReport(data: any): Promise<StpSubmissionResult> {
  const config = ensureConfig();
  if (config.flags.useMockData || !config.banking.baseUrl) {
    return sandboxStpSubmission();
  }

  const result = await callRail<{ reference: string; lodgedAt: string }>({
    method: "POST",
    path: "stp/report",
    payload: data,
  });

  if (!result.ok || !result.data) {
    return {
      ok: false,
      status: result.status,
      error: result.error ?? "STP submission rejected",
      code: result.code,
    };
  }

  return {
    ok: true,
    status: result.status,
    reference: result.data.reference,
    lodgedAt: result.data.lodgedAt,
  };
}

export async function initiateTransfer(paygwDue: number, gstDue: number): Promise<BankTransferResult> {
  const config = ensureConfig();
  const totalCents = Math.round((paygwDue + gstDue) * 100);

  if (config.flags.useMockData || !config.banking.baseUrl) {
    return sandboxTransfer(totalCents);
  }

  const result = await callRail<{ transferId: string; submittedAt: string; receiptReference?: string }>({
    method: "POST",
    path: "transfers",
    payload: {
      totalCents,
      paygwCents: Math.round(paygwDue * 100),
      gstCents: Math.round(gstDue * 100),
      initiatedAt: new Date().toISOString(),
    },
  });

  if (!result.ok || !result.data) {
    return {
      ok: false,
      status: result.status,
      error: result.error ?? "Transfer failed",
      code: result.code,
    };
  }

  return {
    ok: true,
    status: result.status,
    transferId: result.data.transferId,
    submittedAt: result.data.submittedAt,
    receiptReference: result.data.receiptReference,
  };
}

export async function transferToOneWayAccount(amount: number, from: string, to: string): Promise<BankTransferResult> {
  return initiateTransfer(amount, 0);
}

export async function signTransaction(amount: number, account: string): Promise<string> {
  const payload = JSON.stringify({ amount, account, ts: Date.now() });
  const signature = await createSignature(payload);
  return signature ?? `sandbox-signature-${Date.now()}`;
}
