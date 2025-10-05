import { getKillSwitchStatus } from "../safety/killSwitch";

type CapabilityMode = "mock" | "real";

type CapabilityName = "bank" | "kms" | "rates" | "idp";

export interface CapabilityStatus {
  mode: CapabilityMode;
  access: string;
  shadow: boolean;
  state?: string;
  ready: boolean;
  detail?: string;
}

export interface CapabilityRow {
  service: string;
  port: number;
  protocol: string;
  capabilities: Record<CapabilityName, CapabilityStatus>;
}

export interface CapabilityReadyGate {
  ok: boolean;
  requirement: string;
  actual: string;
}

export interface CapabilitiesReport {
  timestamp: string;
  killSwitch: ReturnType<typeof getKillSwitchStatus>;
  matrix: CapabilityRow[];
  ready: Record<CapabilityName, CapabilityReadyGate> & { overall: CapabilityReadyGate };
}

function truthy(value?: string | null): boolean {
  if (!value) return false;
  return /^(1|true|on|yes)$/i.test(value.trim());
}

function parseMode(value: string | undefined | null, fallback: CapabilityMode = "mock"): CapabilityMode {
  const v = value?.toLowerCase();
  if (v === "real" || v === "mock") return v;
  return fallback;
}

function ensureAccess(value: string | undefined | null, fallback: string): string {
  const val = value?.trim();
  return val && val.length > 0 ? val.toLowerCase() : fallback;
}

function buildStatuses(): Record<CapabilityName, CapabilityStatus> {
  const bankMode = parseMode(process.env.BANK_MODE, process.env.BANK_API_BASE ? "real" : "mock");
  const bankWrite = truthy(process.env.BANK_WRITE_ENABLED) || /write/.test((process.env.BANK_ACCESS || "").toLowerCase());
  const bankAccess = ensureAccess(process.env.BANK_ACCESS, bankWrite ? "write" : "read");
  const bankShadow = truthy(process.env.BANK_SHADOW_MODE) || truthy(process.env.BANK_SHADOW);
  const bankReady = bankMode === "real" && /write/.test(bankAccess);

  const kmsBackend = (process.env.KMS_BACKEND ?? "local").toLowerCase();
  const kmsMode: CapabilityMode = kmsBackend === "local" ? "mock" : "real";
  const kmsAccessRaw = (process.env.KMS_ACCESS || process.env.KMS_FEATURES || "").toLowerCase();
  const kmsAccess = kmsAccessRaw.includes("sign") ? "sign" : kmsMode === "real" ? "sign" : "verify";
  const kmsShadow = truthy(process.env.KMS_SHADOW_MODE) || truthy(process.env.KMS_SHADOW);
  const kmsReady = kmsMode === "real" && kmsAccess.includes("sign");

  const ratesMode = parseMode(process.env.RATES_MODE, truthy(process.env.RATES_REAL) ? "real" : "mock");
  const ratesStateRaw = (process.env.RATES_STATUS || process.env.RATES_STATE || (truthy(process.env.RATES_READY) ? "ready" : "lagged")).toLowerCase();
  const ratesShadow = truthy(process.env.RATES_SHADOW_MODE) || truthy(process.env.RATES_SHADOW);
  const ratesReady = ratesStateRaw === "ready";
  const ratesAccess = ensureAccess(process.env.RATES_ACCESS, "read");

  const idpMode = parseMode(process.env.IDP_MODE || process.env.IDP_PROVIDER, "mock");
  const idpMfa = truthy(process.env.IDP_MFA) || /mfa/.test((process.env.IDP_ACCESS || process.env.IDP_AUTH || "").toLowerCase());
  const idpAccess = ensureAccess(process.env.IDP_ACCESS || process.env.IDP_AUTH, idpMfa ? "mfa" : "password");
  const idpShadow = truthy(process.env.IDP_SHADOW_MODE) || truthy(process.env.IDP_SHADOW);
  const idpReady = idpAccess.includes("mfa");

  return {
    bank: {
      mode: bankMode,
      access: bankAccess,
      shadow: bankShadow,
      ready: bankReady,
      detail: bankWrite ? "Write enabled" : "Read only",
    },
    kms: {
      mode: kmsMode,
      access: kmsAccess,
      shadow: kmsShadow,
      ready: kmsReady,
      detail: kmsBackend,
    },
    rates: {
      mode: ratesMode,
      access: ratesAccess,
      shadow: ratesShadow,
      state: ratesStateRaw,
      ready: ratesReady,
      detail: ratesStateRaw,
    },
    idp: {
      mode: idpMode,
      access: idpAccess,
      shadow: idpShadow,
      ready: idpReady,
      detail: idpAccess,
    },
  };
}

function formatActual(status: CapabilityStatus): string {
  const parts = [status.mode];
  if (status.access) parts.push(status.access);
  if (status.shadow) parts.push("shadow");
  if (status.state && !parts.includes(status.state)) parts.push(status.state);
  return parts.join("/");
}

function buildMatrix(statuses: Record<CapabilityName, CapabilityStatus>): CapabilityRow[] {
  const rows: CapabilityRow[] = [];
  const clone = () =>
    Object.fromEntries(
      Object.entries(statuses).map(([key, value]) => [key, { ...value }])
    ) as Record<CapabilityName, CapabilityStatus>;
  const appPort = Number(process.env.PORT) || 3000;
  rows.push({
    service: "app",
    port: appPort,
    protocol: "http",
    capabilities: clone(),
  });

  const paymentsBase = process.env.PAYMENTS_BASE_URL || process.env.NEXT_PUBLIC_PAYMENTS_BASE_URL || "http://localhost:3001";
  try {
    const url = new URL(paymentsBase);
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    rows.push({
      service: "payments",
      port,
      protocol: url.protocol.replace(":", ""),
      capabilities: clone(),
    });
  } catch {
    // ignore invalid URL; skip row
  }

  return rows;
}

export function getCapabilitiesReport(): CapabilitiesReport {
  const statuses = buildStatuses();
  const matrix = buildMatrix(statuses);
  const killSwitch = getKillSwitchStatus();

  const gateStates: Record<CapabilityName, boolean> = {
    bank: statuses.bank.ready,
    kms: statuses.kms.ready,
    rates: statuses.rates.state === "ready",
    idp: statuses.idp.access.includes("mfa"),
  };

  const ready: CapabilitiesReport["ready"] = {
    bank: {
      ok: gateStates.bank,
      requirement: "real(write)",
      actual: formatActual(statuses.bank),
    },
    kms: {
      ok: gateStates.kms,
      requirement: "real(sign)",
      actual: formatActual(statuses.kms),
    },
    rates: {
      ok: gateStates.rates,
      requirement: "ready",
      actual: formatActual(statuses.rates),
    },
    idp: {
      ok: gateStates.idp,
      requirement: "mfa",
      actual: formatActual(statuses.idp),
    },
    overall: {
      ok: (["bank", "kms", "rates", "idp"] as CapabilityName[]).every((name) => gateStates[name]),
      requirement: "bank/kms/rates/idp",
      actual: Object.entries(gateStates)
        .map(([k, v]) => `${k}:${v ? "ok" : "fail"}`)
        .join(","),
    },
  };

  return {
    timestamp: new Date().toISOString(),
    killSwitch,
    matrix,
    ready,
  };
}

export function ensureProdReadiness() {
  if ((process.env.APP_PROFILE || "").toLowerCase() !== "prod") return;
  const report = getCapabilitiesReport();
  const { ready } = report;
  const unmet = Object.entries(ready)
    .filter(([key, gate]) => key !== "overall" && !gate.ok)
    .map(([key, gate]) => `${key} requires ${gate.requirement} (actual ${gate.actual})`);
  if (unmet.length > 0) {
    throw new Error(`APP_PROFILE=prod requires capabilities: ${unmet.join("; ")}`);
  }
}
