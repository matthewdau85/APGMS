import { randomUUID } from "crypto";

export type ProviderMode = "Mock" | "Shadow" | "Real";

export interface ProviderBinding {
  id: string;
  label: string;
  vendor: string;
  mode: ProviderMode;
  status: "connected" | "shadowing" | "disconnected";
  lastSyncIso: string;
}

export interface FeatureFlag {
  key: string;
  label: string;
  enabled: boolean;
  description?: string;
}

export interface QueueState {
  id: string;
  label: string;
  count: number;
  runbook: string;
  lastRunIso?: string | null;
}

type RunbookResult =
  | { allowed: false; status: number; message: string }
  | { allowed: true; status: number; message: string; queue: QueueState };

const env = (key: string, fallback: string): string => {
  const v = process.env[key];
  return v == null || v === "" ? fallback : v;
};

const envBool = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key];
  if (raw == null) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
};

const PAYGW_RATES_VERSION = env("PAYGW_RATES_VERSION", "2024-25");
const GST_RATES_VERSION = env("GST_RATES_VERSION", "GST-2024-07");

const providerModes: Record<string, ProviderMode> = {
  payroll: (env("PROVIDER_PAYROLL_MODE", "Shadow") as ProviderMode) || "Shadow",
  pos: (env("PROVIDER_POS_MODE", "Mock") as ProviderMode) || "Mock",
  bank: (env("PROVIDER_BANK_MODE", "Real") as ProviderMode) || "Real",
};

const providerBindings: ProviderBinding[] = [
  {
    id: "payroll",
    label: "Payroll",
    vendor: env("PROVIDER_PAYROLL_VENDOR", "MYOB Advanced"),
    mode: providerModes.payroll,
    status: providerModes.payroll === "Real" ? "connected" : "shadowing",
    lastSyncIso: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
  {
    id: "pos",
    label: "Point of Sale",
    vendor: env("PROVIDER_POS_VENDOR", "Square AU"),
    mode: providerModes.pos,
    status: providerModes.pos === "Mock" ? "disconnected" : "connected",
    lastSyncIso: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: "bank",
    label: "Bank Feeds",
    vendor: env("PROVIDER_BANK_VENDOR", "Basiq Sandbox"),
    mode: providerModes.bank,
    status: "connected",
    lastSyncIso: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
];

const featureFlags: FeatureFlag[] = [
  {
    key: "shadow_mode",
    label: "Shadow Settlements",
    enabled: envBool("FEATURE_SHADOW_MODE", true),
    description: "Mirror settlements without releasing funds until reviewed.",
  },
  {
    key: "operator_overrides",
    label: "Operator Overrides",
    enabled: envBool("FEATURE_OPERATOR_OVERRIDES", false),
    description: "Allow console operators to force-run guarded actions.",
  },
  {
    key: "auto_release",
    label: "Auto Release on RPT",
    enabled: envBool("FEATURE_AUTO_RELEASE", false),
    description: "Automatically release PAYGW/GST once an RPT is signed.",
  },
];

const queues: QueueState[] = [
  {
    id: "pending-anomalies",
    label: "Pending Anomalies",
    count: 3,
    runbook: "Review anomaly vectors, attach operator note, then requeue via /ops/anomaly/requeue",
  },
  {
    id: "unreconciled-bank",
    label: "Unreconciled Bank Lines",
    count: 5,
    runbook: "Match bank lines using /ops/bank/reconcile or push to suspense account.",
  },
  {
    id: "dead-letter",
    label: "DLQ",
    count: 2,
    runbook: "Inspect payload, patch root cause, then replay with /ops/dlq/replay?dryRun=false.",
  },
];

const badgePriority: ProviderMode[] = ["Real", "Shadow", "Mock"];

const deriveBadge = (): ProviderMode => {
  for (const mode of badgePriority) {
    if (providerBindings.some((p) => p.mode === mode)) {
      return mode;
    }
  }
  return "Mock";
};

const cloneQueue = (q: QueueState): QueueState => ({ ...q });

export const runtimeState = {
  getSummary() {
    return {
      badge: deriveBadge(),
      providers: providerBindings.map((p) => ({ ...p })),
      feature_flags: featureFlags.map((f) => ({ ...f })),
      overrides_enabled:
        featureFlags.find((f) => f.key === "operator_overrides")?.enabled ?? false,
      rates: {
        paygw: PAYGW_RATES_VERSION,
        gst: GST_RATES_VERSION,
      },
    };
  },
  listQueues(): QueueState[] {
    return queues.map(cloneQueue);
  },
  runRunbook(queueId: string): RunbookResult {
    const queue = queues.find((q) => q.id === queueId);
    if (!queue) {
      return { allowed: false, status: 404, message: "Queue not found" };
    }

    const overridesEnabled =
      featureFlags.find((f) => f.key === "operator_overrides")?.enabled ?? false;

    if (!overridesEnabled) {
      return {
        allowed: false,
        status: 412,
        message: "Operator overrides are disabled in this environment",
      };
    }

    queue.count = 0;
    queue.lastRunIso = new Date().toISOString();

    return {
      allowed: true,
      status: 200,
      message: `Runbook executed with override ${randomUUID().slice(0, 8)}`,
      queue: cloneQueue(queue),
    };
  },
};

export type RuntimeSummary = ReturnType<typeof runtimeState.getSummary>;
