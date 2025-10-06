const retries: Record<'BPAY' | 'EFT', number> = { BPAY: 0, EFT: 0 };
let breakerOpen = false;

export function observeRailLatency(channel: 'BPAY' | 'EFT', latencyMs: number, tags: Record<string, string>): void {
  console.log(JSON.stringify({
    level: 'debug',
    metric: 'payments_rail_latency_ms',
    value: latencyMs,
    channel,
    ...tags,
  }));
}

export function incrementRailRetries(channel: 'BPAY' | 'EFT'): void {
  retries[channel] += 1;
  console.log(JSON.stringify({
    level: 'debug',
    metric: 'payments_rail_retries',
    channel,
    value: retries[channel],
  }));
}

export function setBreakerOpen(open: boolean): void {
  if (breakerOpen === open) return;
  breakerOpen = open;
  console.log(JSON.stringify({
    level: 'warn',
    metric: 'payments_rail_breaker_open',
    value: open ? 1 : 0,
  }));
}
