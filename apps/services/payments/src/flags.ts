// apps/services/payments/src/flags.ts
// Centralised prototype feature flags with typed accessors.

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);
const warnedInvalid = new Set<string>();

export type ProtoFlagName =
  | "PROTO_KILL_SWITCH"
  | "PROTO_ENABLE_IDEMPOTENCY"
  | "PROTO_ENABLE_RPT"
  | "PROTO_BLOCK_ON_ANOMALY"
  | "PROTO_ALLOW_OVERRIDES"
  | "PROTO_ENABLE_REAL_BANK";

export interface ProtoFlagsSnapshot {
  PROTO_KILL_SWITCH: boolean;
  PROTO_ENABLE_IDEMPOTENCY: boolean;
  PROTO_ENABLE_RPT: boolean;
  PROTO_BLOCK_ON_ANOMALY: boolean;
  PROTO_ALLOW_OVERRIDES: boolean;
  PROTO_ENABLE_REAL_BANK: boolean;
}

function parseBooleanFlag(name: ProtoFlagName, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;

  if (!warnedInvalid.has(name)) {
    console.warn(`[flags] Ignoring invalid boolean for ${name}: ${raw}`);
    warnedInvalid.add(name);
  }
  return defaultValue;
}

export function getProtoFlags(): ProtoFlagsSnapshot {
  return {
    PROTO_KILL_SWITCH: parseBooleanFlag("PROTO_KILL_SWITCH", true),
    PROTO_ENABLE_IDEMPOTENCY: parseBooleanFlag("PROTO_ENABLE_IDEMPOTENCY", false),
    PROTO_ENABLE_RPT: parseBooleanFlag("PROTO_ENABLE_RPT", true),
    PROTO_BLOCK_ON_ANOMALY: parseBooleanFlag("PROTO_BLOCK_ON_ANOMALY", false),
    PROTO_ALLOW_OVERRIDES: parseBooleanFlag("PROTO_ALLOW_OVERRIDES", false),
    PROTO_ENABLE_REAL_BANK: parseBooleanFlag("PROTO_ENABLE_REAL_BANK", false),
  };
}

export function isProtoKillSwitchEnabled(): boolean {
  return getProtoFlags().PROTO_KILL_SWITCH;
}

export const PROTOTYPE_KILL_SWITCH_MESSAGE = "Prototype mode: egress disabled";
