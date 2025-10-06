# APGMS Prototype Readiness Snapshot (5 Oct 2025)

## Readiness Scores (Mock Prototype Lens)
- **Prototype readiness:** **3 / 10** – Multi-page React console, patent-aligned service scaffolds, and migrations exist, but flows rely on mocked data and unfinished SQL, so the gate → token → release → evidence loop cannot yet execute end-to-end.
- **Production readiness:** **1–2 / 10** – No live rails, hardware-backed keys, or DSP assurance evidence; current controls are insufficient for distribution.

## Current Features
- **Frontend:** Dashboard, BAS, Settings, Audit, Fraud, and Help routes with mock data, compliance gauges, payment reminders, and setup wizard screens.
- **Services & Libraries:** Express gateway plus FastAPI services for gate, reconciliation, payments, and audit bundles; RPT signing stubs; migrations for periods, one-way ledger, and audit tables.
- **Patent Alignment:** Repository structure and docs still mirror the patented gate/token architecture, keeping the implementation on course with the original concept.

## Efficiency Snapshot (Acceptable for Mocking)
- **UI:** Lightweight renders and localised state; efficiency concerns will emerge only once live data sources replace mocks.
- **Backend:** Handlers are short, but database usage is non-functional (placeholder SQL, repeated pool instantiation). No caching or retries yet.
- **Tax Logic:** O(1) arithmetic with flat PAYGW/GST rates – extremely fast but not accurate.

## Delta From Project Start
- **Then:** Concept notes and README-level plans.
- **Now:** Functioning prototype console, service scaffolds, migrations, and utilities that illustrate the gate/token workflow, albeit without real integrations.

## Compliance & Accuracy Gaps
- **ATO DSP requirements:** Missing authentication hardening, logging/audit evidence, incident response artefacts, and assurance pack; therefore **non-compliant** today.
- **Tax rules & rates:** PAYGW/GST logic still uses fixed demo rates, lacks rounding/threshold handling, and ignores current ATO tables – **not accurate**.
- **Automatic updates:** No job or manifest tracks regulatory changes; rates are static and must be manually updated.

## Known Errors & Technical Debt
- Placeholder SQL without parameters, guaranteed to fail at runtime.
- Banking and STP connectors are mocks lacking mTLS, idempotency, or receipts.
- UI copy overstates security posture relative to the codebase.
- PAYGW/GST computations ignore official schedules and adjustments.

## Next Tasks Toward a Pilot-Ready Prototype
1. **Rail + Evidence v2**
   - Stand up a sandbox rail with mTLS, allow-lists, idempotency, and provider reference persistence.
   - Implement reconciliation import, evidence bundles with rules manifest SHA-256, settlement data, narratives, and approval chains.
2. **Rules + Security Slice**
   - Load authoritative PAYGW/GST schedules with golden tests and rounding behaviour.
   - Introduce `RATES_VERSION`, rules manifests, and drift CI checks.
   - Add JWT roles, MFA for mode/release changes, dual approval thresholds, Helmet/CORS/rate limiting, and structured/redacted logs.
3. **Readiness Guardrails**
   - Publish rubric v1.0, CI scorecard, `/ops/readiness` endpoint, simulator parity tests, and DoD linting; block merges on readiness regressions.

## Brief for the Next Assistant
- **What’s done:** Routed React console, mock compliance dashboards, Express/FastAPI service shells, migrations, RPT signer stubs, and patent documentation.
- **What’s next:** Complete readiness guardrails, rail + evidence v2 implementation, and authoritative tax/security features before claiming pilot readiness.

## Action Checklist
- [ ] Parameterise SQL statements and centralise database pooling.
- [ ] Replace mock PAYGW/GST math with table-driven calculations and rounding rules.
- [ ] Integrate sandbox payment rail with mTLS and idempotent releases.
- [ ] Persist reconciliation results into evidence bundles including rules hash and settlement metadata.
- [ ] Enforce authentication, MFA, dual approval, and security headers at service edges.
- [ ] Add rules manifest versioning, drift detection, and automated readiness scoring.

