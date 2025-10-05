function truthy(value?: string | null): boolean {
  if (!value) return false;
  return /^(1|true|on|yes)$/i.test(value.trim());
}

export function isKillSwitchActive(): boolean {
  return truthy(process.env.PROTO_KILL_SWITCH);
}

export function getKillSwitchReason(): string {
  const reason = process.env.PROTO_KILL_SWITCH_REASON?.trim();
  if (reason) return reason;
  return "Prototype payouts are disabled by the kill switch.";
}

export function getKillSwitchStatus() {
  const enabled = isKillSwitchActive();
  return {
    enabled,
    reason: enabled ? getKillSwitchReason() : null,
  };
}

export function respondIfKillSwitch(res: { status: (code: number) => any; json: (body: any) => any; }): boolean {
  if (!isKillSwitchActive()) return false;
  res.status(503).json({
    error: "PAYOUTS_DISABLED",
    reason: getKillSwitchReason(),
  });
  return true;
}
