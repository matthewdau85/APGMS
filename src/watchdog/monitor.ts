import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export interface WatchdogConfig {
  baseUrl: string;
  abn: string;
  taxType: string;
  periodId: string;
  intervalMs: number;
  staleMinutes: number;
}

export interface EndpointRuntime {
  lastFreshIso: string | null;
  lastHash: string | null;
}

export interface WatchdogRuntime {
  hadAlert: boolean;
  endpoints: Record<EndpointKey, EndpointRuntime>;
}

type EndpointKey = "health" | "ledger" | "evidence";

type Logger = Pick<typeof console, "info" | "warn" | "error">;

interface EndpointDefinition {
  key: EndpointKey;
  url: URL;
}

const DEFAULT_LOGGER: Logger = console;

export function createRuntime(): WatchdogRuntime {
  return {
    hadAlert: false,
    endpoints: {
      health: { lastFreshIso: null, lastHash: null },
      ledger: { lastFreshIso: null, lastHash: null },
      evidence: { lastFreshIso: null, lastHash: null },
    },
  };
}

export function snapshotHash(value: unknown): string {
  const canonical = canonicalJson(value);
  return createHash("sha256").update(canonical).digest("hex");
}

export function extractLedgerFreshness(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const rows = (payload as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  let latest: string | null = null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const candidate = coerceIso(
      (row as Record<string, unknown>).created_at ??
        (row as Record<string, unknown>).createdAt ??
        (row as Record<string, unknown>).ts
    );
    latest = pickLater(latest, candidate);
  }
  return latest;
}

export function extractEvidenceFreshness(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  let latest: string | null = null;
  const obj = payload as Record<string, unknown>;

  latest = pickLater(latest, coerceIso(obj.generated_at));

  if (obj.meta && typeof obj.meta === "object") {
    latest = pickLater(latest, coerceIso((obj.meta as Record<string, unknown>).generated_at));
  }

  if (obj.rpt && typeof obj.rpt === "object") {
    const rpt = obj.rpt as Record<string, unknown>;
    latest = pickLater(latest, coerceIso(rpt.created_at));
    if (rpt.payload && typeof rpt.payload === "object") {
      latest = pickLater(latest, coerceIso((rpt.payload as Record<string, unknown>).expiry_ts));
    }
  }

  const deltas = readEntries(obj.owa_ledger_deltas);
  const ledger = readEntries(obj.owa_ledger);

  for (const entry of [...deltas, ...ledger]) {
    const candidate = coerceIso(
      entry.ts ?? entry.created_at ?? entry.createdAt ?? entry.timestamp
    );
    latest = pickLater(latest, candidate);
  }

  return latest;
}

function readEntries(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

export function computeStaleness(
  freshIso: string | null,
  staleMinutes: number,
  now: Date = new Date()
): { stale: boolean; ageMs: number | null } {
  if (!freshIso) return { stale: true, ageMs: null };
  const ts = Date.parse(freshIso);
  if (Number.isNaN(ts)) return { stale: true, ageMs: null };
  const ageMs = now.getTime() - ts;
  const staleMs = staleMinutes * 60_000;
  return { stale: ageMs > staleMs, ageMs };
}

export async function pollEndpoints(
  config: WatchdogConfig,
  state: WatchdogRuntime,
  log: Logger = DEFAULT_LOGGER,
  now: Date = new Date()
): Promise<void> {
  const endpoints: EndpointDefinition[] = [
    { key: "health", url: new URL("/health", config.baseUrl) },
    {
      key: "ledger",
      url: buildUrl(config.baseUrl, "/api/ledger", {
        abn: config.abn,
        taxType: config.taxType,
        periodId: config.periodId,
      }),
    },
    {
      key: "evidence",
      url: buildUrl(config.baseUrl, "/api/evidence", {
        abn: config.abn,
        taxType: config.taxType,
        periodId: config.periodId,
      }),
    },
  ];

  for (const endpoint of endpoints) {
    const runtime = state.endpoints[endpoint.key];
    try {
      const response = await fetch(endpoint.url);
      if (!response.ok) {
        log.error(
          `[watchdog] ${endpoint.key} request failed with status ${response.status}`
        );
        state.hadAlert = true;
        continue;
      }
      const json: unknown = await response.json();
      runtime.lastHash = snapshotHash(json);

      if (endpoint.key === "health") {
        handleHealth(json, state, log);
        continue;
      }

      const freshIso =
        endpoint.key === "ledger"
          ? extractLedgerFreshness(json)
          : extractEvidenceFreshness(json);
      runtime.lastFreshIso = freshIso;

      const { stale, ageMs } = computeStaleness(freshIso, config.staleMinutes, now);
      if (stale) {
        const ageLabel = formatAge(ageMs);
        log.error(
          `[watchdog] ${endpoint.key} appears stale (freshness ${freshIso ?? "unknown"}, age ${ageLabel})`
        );
        state.hadAlert = true;
      } else {
        const ageLabel = formatAge(ageMs);
        log.info(
          `[watchdog] ${endpoint.key} fresh as of ${freshIso} (age ${ageLabel})`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`[watchdog] ${endpoint.key} request failed: ${message}`);
      state.hadAlert = true;
    }
  }
}

export async function runWatchdog(
  config: WatchdogConfig,
  options: {
    signal?: AbortSignal;
    log?: Logger;
    state?: WatchdogRuntime;
    now?: () => Date;
  } = {}
): Promise<WatchdogRuntime> {
  const { signal, log = DEFAULT_LOGGER, now = () => new Date() } = options;
  const state = options.state ?? createRuntime();

  while (!signal?.aborted) {
    await pollEndpoints(config, state, log, now());
    try {
      await delay(config.intervalMs, undefined, { signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        break;
      }
      throw error;
    }
  }

  return state;
}

function handleHealth(payload: unknown, state: WatchdogRuntime, log: Logger): void {
  if (payload && typeof payload === "object") {
    const ok = Boolean((payload as Record<string, unknown>).ok);
    if (!ok) {
      log.error("[watchdog] health endpoint returned a non-ok payload");
      state.hadAlert = true;
    } else {
      log.info("[watchdog] health endpoint OK");
    }
    return;
  }
  log.error("[watchdog] health endpoint returned invalid payload");
  state.hadAlert = true;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, val]) => [key, canonicalJson(val)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${val}`).join(",")}}`;
}

function coerceIso(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const timestamp = Date.parse(trimmed);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return null;
}

function pickLater(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate > current ? candidate : current;
}

function formatAge(ageMs: number | null): string {
  if (ageMs === null) return "unknown";
  if (!Number.isFinite(ageMs)) return "unknown";
  const totalSeconds = Math.max(0, Math.round(ageMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function buildUrl(base: string, pathname: string, query: Record<string, string>): URL {
  const url = new URL(pathname, base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}
