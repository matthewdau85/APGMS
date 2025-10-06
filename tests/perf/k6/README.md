# k6 performance scenarios

This folder contains k6 scripts that exercise the deposit → close → release flow at scale.

## `deposit-close-release.js`

* Constant arrival rate executor with configurable target RPS (`TARGET_RPS`, default 20).
* Sequentially issues `/api/deposit`, `/api/close-issue`, and `/api/release` requests.
* SLO assertions on request success, p95 latency, and per-flow check success ratios.
* Environment variables:
  * `BASE_URL` – root of the APGMS application (default `http://localhost:3000`).
  * `TARGET_RPS`, `DURATION`, `VUS`, `MAX_VUS` – load profile.
  * `AMOUNT_CENTS`, `ABN`, `TAX_TYPE`, `PERIOD_ID` – payload customisation.
  * `PAUSE_SECONDS` – pacing between iterations.

Run with:

```sh
k6 run tests/perf/k6/deposit-close-release.js
```

Set `K6_WEB_DASHBOARD=true` to enable the web dashboard when supported.
