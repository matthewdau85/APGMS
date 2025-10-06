# Payments throughput k6 scenarios

- `deposit-close-release.js` — drives the deposit → close → release flow at a configurable arrival rate. The script asserts 95th percentile latency SLOs for each leg and tolerates expected error codes when the release queue is saturated or a DLQ replay is pending.
- Set `BASE_URL`, `TARGET_RPS`, and `DURATION` to match the environment under test. The default target is 25 rps for one minute.
- Provide `TEST_ABN`, `TEST_TAX_TYPE`, and `TEST_PERIOD_ID` if you need to pin to a specific ledger row.

Run with:

```bash
k6 run tests/perf/k6/deposit-close-release.js
```

The chaos tests in `tests/chaos/releaseDlqChaos.test.js` can be executed via `npx tsx tests/chaos/releaseDlqChaos.test.js` to verify DLQ population under database failover or banking timeouts.
