import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const requestLatency = new client.Histogram({
  name: 'payments_request_latency_seconds',
  help: 'HTTP request latency for the payments service',
  labelNames: ['route', 'method', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

export const rptIssuedTotal = new client.Counter({
  name: 'rpt_issued_total',
  help: 'Total RPT tokens issued',
});

export const payoutAttemptTotal = new client.Counter({
  name: 'payout_attempt_total',
  help: 'Total payout attempts observed',
});

export const anomalyBlockTotal = new client.Counter({
  name: 'anomaly_block_total',
  help: 'Total requests blocked due to anomaly conditions',
});

register.registerMetric(requestLatency);
register.registerMetric(rptIssuedTotal);
register.registerMetric(payoutAttemptTotal);
register.registerMetric(anomalyBlockTotal);

export type Timer = (status?: string | number) => void;

export function startTimer(labels: { route: string; method: string }): Timer {
  const end = requestLatency.startTimer(labels);
  return (status?: string | number) => {
    end({ status: status ? String(status) : undefined });
  };
}
