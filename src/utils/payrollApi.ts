import { getPayrollApiConfig } from "./serviceConfig";

class PayrollApiError extends Error {
  constructor(message: string, readonly status?: number, readonly details?: unknown) {
    super(message);
    this.name = "PayrollApiError";
  }
}

type OAuthToken = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: OAuthToken | null = null;

async function getAccessToken(): Promise<string> {
  const config = getPayrollApiConfig();
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }

  const payload = new URLSearchParams({
    grant_type: "client_credentials",
  });
  if (config.oauth.scope) {
    payload.set("scope", config.oauth.scope);
  }

  const response = await fetch(config.oauth.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${config.oauth.clientId}:${config.oauth.clientSecret}`).toString("base64")}`,
    },
    body: payload.toString(),
  });

  if (!response.ok) {
    throw new PayrollApiError("Failed to obtain payroll OAuth token", response.status, await safeJson(response));
  }

  const tokenResponse = (await response.json()) as { access_token: string; expires_in?: number };
  const expiresInSeconds = tokenResponse.expires_in ?? 300;
  tokenCache = {
    accessToken: tokenResponse.access_token,
    expiresAt: Date.now() + Math.max(expiresInSeconds - 30, 30) * 1000,
  };

  return tokenCache.accessToken;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch (error) {
    return { error: "unparseable", message: (error as Error).message };
  }
}

interface PayrollRequestInit {
  method?: string;
  body?: unknown;
}

async function payrollRequest<T>(path: string, init: PayrollRequestInit = {}): Promise<T> {
  const config = getPayrollApiConfig();
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  let body: string | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers["Content-Type"] = "application/json";
  }

  const url = new URL(path, config.baseUrl).toString();
  const response = await fetch(url, {
    method: init.method ?? "POST",
    headers,
    body,
  });

  if (!response.ok) {
    throw new PayrollApiError("Payroll API request failed", response.status, await safeJson(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export interface PayrollEmployee {
  id: string;
  taxFileNumber: string;
  grossPay: number;
  superannuation: number;
}

export interface PayrollBatch {
  periodStart: string;
  periodEnd: string;
  employees: PayrollEmployee[];
}

export interface PayrollSubmissionResponse {
  submissionId: string;
  status: "queued" | "accepted" | "rejected";
}

export async function submitPayrollBatch(batch: PayrollBatch): Promise<PayrollSubmissionResponse> {
  return payrollRequest<PayrollSubmissionResponse>("/payroll/batches", { body: batch });
}

export interface PayrollStatusResponse {
  submissionId: string;
  status: "queued" | "accepted" | "rejected" | "processing";
  processedAt?: string;
}

export async function fetchPayrollStatus(submissionId: string): Promise<PayrollStatusResponse> {
  return payrollRequest<PayrollStatusResponse>(`/payroll/batches/${submissionId}`, { method: "GET" });
}

export function __resetPayrollTokenCache() {
  tokenCache = null;
}

