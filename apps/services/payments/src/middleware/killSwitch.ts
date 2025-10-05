import type { Response } from 'express';

function truthy(value?: string | null): boolean {
  if (!value) return false;
  return /^(1|true|on|yes)$/i.test(value.trim());
}

function isKillSwitchActive(): boolean {
  return truthy(process.env.PROTO_KILL_SWITCH);
}

function getKillSwitchReason(): string {
  const reason = process.env.PROTO_KILL_SWITCH_REASON?.trim();
  return reason && reason.length > 0
    ? reason
    : 'Prototype payouts are disabled by the kill switch.';
}

export function respondIfKillSwitch(res: Response): boolean {
  if (!isKillSwitchActive()) return false;
  res.status(503).json({
    error: 'PAYOUTS_DISABLED',
    reason: getKillSwitchReason(),
  });
  return true;
}
