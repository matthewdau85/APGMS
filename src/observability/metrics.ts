import { Counter, Registry, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "apgms_" });

export const releaseAttemptsCounter = new Counter({
  name: "apgms_release_attempts_total",
  help: "Number of attempts to release payments",
  registers: [registry],
});

export const releaseSuccessCounter = new Counter({
  name: "apgms_release_success_total",
  help: "Number of successful payment releases",
  registers: [registry],
});

export const releaseFailureCounter = new Counter({
  name: "apgms_release_failure_total",
  help: "Number of failed payment releases",
  registers: [registry],
});

export const reconciliationImportsCounter = new Counter({
  name: "apgms_reconciliation_import_total",
  help: "Number of reconciliation import requests processed",
  registers: [registry],
});
