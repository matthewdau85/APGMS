# Runbook: Elevated Request Latency

## When to Use
* Alert **HTTP latency SLO burn** fired for any service (`histogram_quantile(0.95, ...)` > 0.5s for 5m).

## Immediate Actions
1. Validate whether load increased by inspecting the *HTTP Request Rate* panel and recent deploys (`service_metadata`).
2. Check database pool utilisation for the same service on the *DB Pool Usage* panel.

## Remediation Steps
* If DB pool is saturated, recycle long-lived connections and verify query plans.
* If CPU saturation is observed on the host, scale replicas or roll back to the previous version.
* For the tax-engine, confirm NATS connectivity (`taxengine_nats_connected`) remains at 1.

## Escalation
* If latency remains above threshold for more than 30 minutes, create an incident and coordinate with the owning team for failover options.
