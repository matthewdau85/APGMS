# Service Level Objectives

SLOs ensure the APGMS platform meets availability and correctness expectations. Breaches trigger incident workflows and feed DSP evidence.

| SLO | Target | Measurement | Proof |
| --- | --- | --- | --- |
| Availability | 99.9% rolling 30 days | Uptime from synthetic checks + API health probes | `compliance:daily` metrics snapshot (`apgms_availability` in Prometheus) |
| API Latency (p95) | < 350 ms | `/metrics` histogram `apgms_api_latency_bucket` | Metrics artifact + `/ops/compliance/proofs` (latency derived via DLQ replay latency proxy) |
| DLQ Replay Latency | < 600 ms mean | Dead letter queue telemetry (`mean_replay_latency_ms`) | `/ops/compliance/proofs` JSON + metrics artifact |
| Release Success Rate | ≥ 98% over 30 days | Release pipeline success counters | Metrics snapshot (pipeline counters) + dual approvals evidence |

## Operational Workflow
1. Prometheus scrapes exported metrics every 30 seconds and backs them up via `compliance:daily` job.
2. Alerts fire when error budget consumption exceeds 20%; the incident commander references this document during response.
3. `/ops/compliance/proofs` exposes the DLQ proxy and dual approval counts used during audits to demonstrate continued monitoring.
4. Quarterly SLO review includes verifying Grafana dashboard snapshots are archived with the compliance artifact.

## Ownership
- **SRE Lead** – Maintains SLO configurations and dashboards.
- **Compliance Officer** – Reviews artifacts monthly to confirm objectives align with DSP commitments.
