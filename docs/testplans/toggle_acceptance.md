# Toggle Acceptance Test Plan

This plan enumerates the automated checks that must pass before accepting a toggle rollout across the mock and real contract providers.

## 1. No Code Diff
- **Goal:** Confirm that switching between profiles does not introduce uncommitted changes.
- **Automation:**
  1. Check out the repository profile under test.
  2. Run `git status --short` and assert that the working tree is clean.
  3. Fail if any file appears as modified, added, or deleted.

## 2. Contract Parity
- **Goal:** Ensure API contract compatibility between mock and real providers.
- **Automation:**
  1. Execute `contract-tests` against the mock provider; capture the emitted schema.
  2. Execute `contract-tests` against the real provider; capture the emitted schema.
  3. Diff the two schemas and fail if any structural differences are detected.

## 3. Shadow Stability
- **Goal:** Validate stability when mirroring live traffic in shadow mode.
- **Automation:**
  1. Run the shadow harness with `SHADOW_MODE=true` for 10,000 operations covering the representative workload mix.
  2. Track mismatches between mock and real responses.
  3. Fail if the mismatch rate is greater than or equal to 0.5%.

## 4. Idempotency Parity
- **Goal:** Verify that replayed operations mutate state exactly once on both providers.
- **Automation:**
  1. Re-run the recorded fixture suite against the mock provider; assert that each ledger entry mutates only once.
  2. Repeat against the real provider with the same fixtures.
  3. Fail if any ledger entry shows multiple mutations or diverging mutation counts between providers.

## 5. Rates Pinning
- **Goal:** Ensure rate calculations rely on the same pinned metadata across providers.
- **Automation:**
  1. For each test date in the fixture set, record the `rates_version.id` used by the mock provider.
  2. Replay the same workload on the real provider.
  3. Fail if any test date resolves to a different `rates_version.id` between providers.

## 6. Latency SLO
- **Goal:** Maintain latency expectations when switching to the real provider.
- **Automation:**
  1. Generate demo-load traffic against both mock and real providers.
  2. Compute p95 latency for each run.
  3. Fail if the real-provider p95 exceeds three times the mock-provider p95.

## 7. Audit Completeness
- **Goal:** Confirm that audit trails remain complete across providers.
- **Automation:**
  1. Capture audit records emitted by mock and real runs for the common fixture set.
  2. Validate presence of all required audit fields (timestamp, actor, operation, target, payload hash, status).
  3. Fail if any required field is missing or null in either provider's audit output.

