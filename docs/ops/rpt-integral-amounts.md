# RPT Integral Amounts Rollout

## Summary
We now sign remittance protection tokens (RPT) using integer-cent amounts to eliminate floating-point drift. This change is
behind the `apgms.rpt.enforce_integral_amounts` feature flag (default **on**).

## Enabling / Disabling
- Default behaviour rejects float inputs. Override temporarily with `APGMS_RPT_ALLOW_FLOAT_INPUTS=1`.
- Never leave the override enabled longer than a single incident response cycle.

## Runbook
1. **Symptoms**: Downstream callers still sending floats will see `TypeError: Money values must be expressed...`.
2. **Immediate mitigation**: Set `APGMS_RPT_ALLOW_FLOAT_INPUTS=1` in the affected environment's secrets store.
3. **Verification**: Re-run the failed job/request; monitor logs for matching `trace_id`/`idempotency_key` pairs to ensure
   only the intended call retried.
4. **Cleanup**: Coordinate with owning team to deploy integer/decimal fixes, then remove the override and confirm no new
   TypeErrors within two monitoring intervals.

## Observability
- Track error counts on the RPT build path with filters for `trace_id` and `idempotency_key` to preserve auditability.
- Add a temporary alert on the `apgms.rpt.enforce_integral_amounts` flag if it stays disabled > 24h.

## Testing
Use `pytest tests/compliance/test_rpt_money_integrity.py` to confirm enforcement logic before rollout.
