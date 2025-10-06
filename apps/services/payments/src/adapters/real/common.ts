import axios, { AxiosInstance } from "axios";
import https from "node:https";
import { readFileSync } from "node:fs";

export interface MtlsOptions {
  caPath?: string;
  certPath?: string;
  keyPath?: string;
}

export interface HttpAdapterOptions extends MtlsOptions {
  baseUrl: string;
  timeoutMs: number;
  dryRun: boolean;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface BackoffOptions {
  retries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export function createMtlsAgent(opts: MtlsOptions): https.Agent {
  const { caPath, certPath, keyPath } = opts;
  const agentOptions: https.AgentOptions = {
    keepAlive: true,
    rejectUnauthorized: true,
  };
  if (caPath) agentOptions.ca = readFileSync(caPath);
  if (certPath) agentOptions.cert = readFileSync(certPath);
  if (keyPath) agentOptions.key = readFileSync(keyPath);
  return new https.Agent(agentOptions);
}

export function createHttpClient(opts: HttpAdapterOptions): AxiosInstance {
  const httpsAgent = createMtlsAgent(opts);
  const baseURL = opts.baseUrl.replace(/\/?$/, "");
  return axios.create({ baseURL, timeout: opts.timeoutMs, httpsAgent });
}

export async function withExponentialBackoff<T>(
  operation: () => Promise<T>,
  { retries = 3, initialDelayMs = 250, maxDelayMs = 2000 }: BackoffOptions = {}
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= retries) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt === retries) {
        throw lastError;
      }
      const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Operation failed");
}

export function isDryRunEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function sanitizeBaseUrl(url: string | undefined): string {
  if (!url) throw new Error("BANK_API_BASE is required");
  return url.replace(/\/$/, "");
}
