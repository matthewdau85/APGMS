# Provider contract tests

This harness exercises each integration port twice – once against the mock implementation and once against the "real" facade – to ensure both variants observe the same behavioural contract.  Each spec captures the response shape, error semantics, idempotency guarantees, timeout configuration, and list of retriable error codes so that divergences cause CI to fail.

## Layout

```
contracts/
  *.spec.ts                # Individual provider specs
  allowlist.json           # Paths that are allowed to diverge between mock/real
  providers/               # Provider factories (mock + real)
  runContracts.ts          # Test harness (invoked from CI)
  scripts/generateContract.ts  # Helper for stubbing new contracts
```

Specs use the shared `ContractSpecContext` helper to load `mock` or `real` providers.  Real providers are guarded behind the `CONTRACT_TESTS_REAL` feature flag (or provider-specific overrides like `CONTRACT_TESTS_REAL_BANK`).  When the gate is disabled the run is recorded as skipped and comparison is deferred.

## Running locally

```
pnpm contract-tests                 # run mock suites and compare results
CONTRACT_TESTS_REAL=1 pnpm contract-tests   # include the real providers
```

If comparisons reveal differences that are both intentional and temporary, add the affected field path (for example `"bank": ["timeoutMs"]`) to `allowlist.json`.  CI fails whenever a difference is not covered by this list.

## Generating new contracts

Use the helper script to scaffold a new provider contract:

```
npx tsx contracts/scripts/generateContract.ts clearinghouse
```

The generator creates a spec and mock/real provider stubs, and updates `providers/index.ts`.  Fill in the stubs with the real implementation details before enabling the suite in CI.

## CI integration

A dedicated `contract-tests` job should invoke `pnpm contract-tests`.  The job will exit non-zero when:

* A spec throws or fails an assertion
* The real run is enabled and produces behavioural differences not captured in `allowlist.json`
* Either provider is missing required invariants (response type, error semantics, idempotency, timeout, retriable codes)
