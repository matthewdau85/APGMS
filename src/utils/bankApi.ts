import nacl from "tweetnacl";

import { getBankApiConfig } from "./serviceConfig";

class BankApiError extends Error {
  constructor(message: string, readonly status?: number, readonly details?: unknown) {
    super(message);
    this.name = "BankApiError";
  }
}

type OAuthToken = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: OAuthToken | null = null;

function getSigningKeypair() {
  const { signingSeed } = getBankApiConfig();
  const seed = Buffer.from(signingSeed, "base64");
  if (seed.length !== nacl.sign.seedLength) {
    throw new BankApiError(
      `BANK_API_SIGNING_KEY must decode to ${nacl.sign.seedLength} bytes, received ${seed.length}.`,
    );
  }
  return nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
}

async function getAccessToken(): Promise<string> {
  const config = getBankApiConfig();
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
    throw new BankApiError("Failed to obtain OAuth token", response.status, await safeJson(response));
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

async function bankRequest<T>(path: string, init: RequestInit & { requiresSignature?: boolean; body?: unknown }): Promise<T> {
  const config = getBankApiConfig();
  const token = await getAccessToken();
  const url = new URL(path, config.baseUrl).toString();

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  let body: string | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers["Content-Type"] = "application/json";
  }

  if (init.requiresSignature && body) {
    headers["X-Payload-Signature"] = signPayload(body);
  }

  const response = await fetch(url, {
    method: init.method ?? "POST",
    headers,
    body,
  });

  if (!response.ok) {
    throw new BankApiError("Bank API request failed", response.status, await safeJson(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function signPayload(payload: string): string {
  const { secretKey } = getSigningKeypair();
  const signature = nacl.sign.detached(Buffer.from(payload), secretKey);
  return Buffer.from(signature).toString("base64");
}

export async function submitSTPReport<T extends Record<string, unknown>>(data: T): Promise<boolean> {
  await bankRequest("/stp/reports", { body: data, requiresSignature: true });
  return true;
}

export async function signTransaction(amount: number, account: string): Promise<string> {
  const payload = JSON.stringify({ amount, account, timestamp: Date.now() });
  return signPayload(payload);
}

export async function transferToOneWayAccount(amount: number, from: string, to: string): Promise<boolean> {
  await bankRequest("/transfers/one-way", {
    body: { amount, fromAccount: from, toAccount: to, requestedAt: new Date().toISOString() },
    requiresSignature: true,
  });
  return true;
}

export async function verifyFunds(paygwDue: number, gstDue: number): Promise<boolean> {
  const response = await bankRequest<{ sufficient: boolean }>("/funds/verify", {
    method: "POST",
    body: { paygwDue, gstDue },
  });
  return response.sufficient;
}

export async function initiateTransfer(paygwDue: number, gstDue: number): Promise<boolean> {
  await bankRequest("/transfers/initiate", {
    body: { paygwDue, gstDue },
    requiresSignature: true,
  });
  return true;
}

export function __resetBankTokenCache() {
  tokenCache = null;
}

