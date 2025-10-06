# Runbook: DLQ Replay

## When to Use
* Alert **DLQ depth breach** fired (`max by (service, queue) (apgms_dlq_messages)` > 0 for 15 minutes).
* Grafana panel: *DLQ Depth* in the APGMS Overview dashboard.

## Immediate Actions
1. Confirm the affected `service` and `queue` labels from the alert payload.
2. Check request health for the same service via the *HTTP Request Rate* panel to ensure traffic is not still failing.
3. Identify root cause in application logs (usually message schema or downstream outage).

## Replay Procedure
1. Pause producers if they are still generating failing messages.
2. Drain the DLQ using the service-specific replay command:
   ```bash
   docker compose exec normalizer python -m app.scripts.replay_dlq --queue <queue>
   ```
3. Monitor `apgms_dlq_messages{queue="<queue>"}` until it reaches zero.
4. Resume producers and validate downstream success metrics.

## Escalation
* If messages repeatedly dead-letter after two replay attempts, page the owning team lead and open an incident in the on-call tracker.
