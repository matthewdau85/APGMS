# Service Level Objectives

The following objectives use the common metrics exported by APGMS services. All
metrics include the labels `service`, `version`, and `env` for correlation with
releases.

| SLO | Target | Measurement | Notes |
| --- | --- | --- | --- |
| Availability | 99.5% monthly | `1 - (sum(rate(apgms_http_requests_total{status=~"5.."}[5m])) / sum(rate(apgms_http_requests_total[5m])))` | Evaluated separately per service. |
| Latency (P95) | < 500 ms | `histogram_quantile(0.95, sum by (le,service) (rate(apgms_http_request_duration_seconds_bucket[5m])))` | Alert at 80% of budget exhaustion. |
| DLQ Depth | Cleared within 15 minutes | `max_over_time(apgms_dlq_messages[15m])` | Measured per queue; breaching indicates replay required. |
| DB Pool Saturation | < 80% active connections | `apgms_db_pool_connections{state="active"} / ignoring(state) apgms_db_pool_connections{state="total"}` | Breach triggers connection leak investigation. |
| Release Failure Rate | < 1 per release window | `increase(apgms_release_failures_total[24h])` | Tracked per stage (`stage` label). |

SLO evaluations and alert thresholds are codified in Grafana alert rules that
consume the same expressions shown above.
