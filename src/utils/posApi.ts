import crypto from "node:crypto";

import { getPosApiConfig } from "./serviceConfig";

class PosApiError extends Error {
  constructor(message: string, readonly status?: number, readonly details?: unknown) {
    super(message);
    this.name = "PosApiError";
  }
}

interface PosRequestInit {
  method?: string;
  body?: unknown;
  path: string;
}

function signPayload(body: string, timestamp: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

async function posRequest<T>({ method = "POST", body, path }: PosRequestInit): Promise<T> {
  const config = getPosApiConfig();
  const timestamp = new Date().toISOString();
  const url = new URL(path, config.baseUrl).toString();

  let payload: string | undefined;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Api-Key": config.apiKey,
    "X-Request-Timestamp": timestamp,
  };

  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
    headers["X-Signature"] = signPayload(payload, timestamp, config.sharedSecret);
  }

  const response = await fetch(url, { method, headers, body: payload });

  if (!response.ok) {
    throw new PosApiError("POS API request failed", response.status, await safeJson(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch (error) {
    return { error: "unparseable", message: (error as Error).message };
  }
}

export interface PosSaleItem {
  sku: string;
  quantity: number;
  total: number;
}

export interface PosSaleBatch {
  locationId: string;
  businessDate: string;
  items: PosSaleItem[];
}

export interface PosBatchResponse {
  batchId: string;
  status: "accepted" | "pending";
}

export async function submitPosBatch(batch: PosSaleBatch): Promise<PosBatchResponse> {
  return posRequest<PosBatchResponse>({ path: "/v1/pos/batches", body: batch });
}

export interface PosSettlementStatus {
  batchId: string;
  settled: boolean;
  settlementDate?: string;
}

export async function fetchSettlementStatus(batchId: string): Promise<PosSettlementStatus> {
  return posRequest<PosSettlementStatus>({ path: `/v1/pos/batches/${batchId}/settlement`, method: "GET" });
}

