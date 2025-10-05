export enum FeatureGate {
  ProtoAllowOverrides = "PROTO_ALLOW_OVERRIDES",
  ShadowMode = "SHADOW_MODE",
  KillSwitchActive = "KILL_SWITCH_ACTIVE",
  RptIssuanceEnabled = "RPT_ISSUANCE_ENABLED",
}

export const FEATURE_GATE_LABELS: Record<FeatureGate, string> = {
  [FeatureGate.ProtoAllowOverrides]: "Proto Overrides",
  [FeatureGate.ShadowMode]: "Shadow Mode",
  [FeatureGate.KillSwitchActive]: "Kill Switch",
  [FeatureGate.RptIssuanceEnabled]: "Issue RPT",
};
