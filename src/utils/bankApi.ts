import { v4 as uuid } from "uuid";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface TransferRequest {
  amountCents: number;
  debitAccount: string;
  creditAccount: string;
  reference: string;
}

export interface TransferResponse {
  bankReceiptHash: string;
  providerTransferId: string;
  status: "SETTLED" | "PENDING";
}

export interface TransferBundle {
  paygw: TransferResponse;
  gst: TransferResponse;
}

export interface FundsVerificationResponse {
  sufficient: boolean;
  availableCents: number;
}

export interface SubmitStpPayload {
  period: string;
  paygwCents: number;
  gstCents: number;
}

export interface SubmitStpResponse {
  confirmationId: string;
  acceptedAt: string;
}

interface ApiErrorPayload {
  error?: string;
  detail?: unknown;
  status?: number;
}

const DEFAULT_BASE = "/api/payments";

function getBaseUrl(): string {
  const candidate =
    (typeof window !== "undefined" && (window as any).__APGMS_PAYMENTS_URL__) ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_PAYMENTS_URL) ||
    (typeof process !== "undefined" && process.env.REACT_APP_PAYMENTS_URL) ||
    DEFAULT_BASE;
  return candidate.replace(/\/$/, "");
}

async function request<T>(path: string, method: HttpMethod, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": uuid(),
  };

  const res = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const detail: ApiErrorPayload = typeof payload === "string" ? { detail: payload } : payload;
    const err = new Error(detail?.error || `Request failed with status ${res.status}`);
    (err as Error & { status?: number; detail?: unknown }).status = res.status;
    (err as Error & { status?: number; detail?: unknown }).detail = detail?.detail ?? payload;
    throw err;
  }

  return payload as T;
}

export async function submitSTPReport(data: SubmitStpPayload): Promise<SubmitStpResponse> {
  return request<SubmitStpResponse>("/stp/report", "POST", data);
}

export async function verifyFunds(paygwDue: number, gstDue: number): Promise<FundsVerificationResponse> {
  return request<FundsVerificationResponse>("/bank/verify", "POST", { paygwDue, gstDue });
}

export async function initiateTransfer(paygwDue: number, gstDue: number): Promise<TransferBundle> {
  return request<TransferBundle>("/bank/transfer", "POST", { paygwDue, gstDue });
}

export async function transferToOneWayAccount(
  amount: number,
  from: string,
  to: string,
  reference = "OWA" + new Date().toISOString()
): Promise<TransferResponse> {
  return request<TransferResponse>("/bank/manualTransfer", "POST", {
    amount,
    from,
    to,
    reference,
  });
}
