export type ProviderMode = "Mock" | "Shadow" | "Real";

export type ProviderBinding = {
  id: string;
  label: string;
  vendor: string;
  mode: ProviderMode;
  status: "connected" | "shadowing" | "disconnected";
  lastSyncIso: string;
};

export type FeatureFlag = {
  key: string;
  label: string;
  enabled: boolean;
  description?: string;
};

export type RuntimeSummary = {
  badge: ProviderMode;
  providers: ProviderBinding[];
  feature_flags: FeatureFlag[];
  overrides_enabled: boolean;
  rates: {
    paygw: string;
    gst: string;
  };
};

export type QueueState = {
  id: string;
  label: string;
  count: number;
  runbook: string;
  lastRunIso?: string | null;
};
