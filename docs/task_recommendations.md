# Task Recommendations

## Task Index

| ID   | Summary                                                                        | Section |
|------|--------------------------------------------------------------------------------|---------|
| T1.1 | Parameterize SQL across period, RPT, release, and evidence endpoints           | 1       |
| T1.2 | Implement validated query helpers and integration coverage                     | 1       |
| T1.3 | Wrap release flow in a database transaction                                    | 1       |
| T2.1 | Model ATO PAYGW schedules with versioning                                      | 2       |
| T2.2 | Implement tested PAYGW calculations                                            | 2       |
| T2.3 | Deliver GST calculations with BAS label exposure                               | 2       |
| T3.1 | Ship migrations and persistence for periods, RPT tokens, and OWA ledger        | 3       |
| T3.2 | Build repositories/services for RPT lifecycle and ledger entries               | 3       |
| T3.3 | Connect payroll/STP and POS ingestion with validation + DLQ                    | 3       |
| T3.4 | Add replay job for merkle root and anomaly recomputation                       | 3       |
| T4.1 | Enforce MFA/SoD and role-based access on risky routes                          | 4       |
| T4.2 | Implement structured, tamper-evident audit logging                             | 4       |
| T4.3 | Move signing keys to managed KMS/HSM with rotation                             | 4       |
| T4.4 | Produce compliance artefacts (IR/DR, pen test, PIA)                            | 4       |
| T5.1 | Build rules ingestion and approval pipeline                                    | 5       |
| T5.2 | Add PAYGW/GST golden tests per fiscal year                                     | 5       |
| T5.3 | Stand up end-to-end CI smoke pipeline                                          | 5       |
| T5.4 | Establish monitoring dashboards and SLOs for core flows                        | 5       |

## 1. Stabilize API queries and state transitions
- Replace the raw SQL fragments in `server.js` with parameterized statements so the Express API actually runs. Right now the `pool.query` calls under `/period/status`, `/rpt/issue`, `/release`, and `/evidence` embed placeholders like `select * from periods where abn=` without column bindings, which will throw syntax errors at runtime and block any flow that tries to issue or release an RPT.
- Add explicit transaction handling around the `/release` path so the OWA debit (`owa_append`) and the period state update to `RELEASED` succeed or fail together.

### Tasks
- [ ] **T1.1** Draft parameterized SQL queries for each affected endpoint and review column coverage against the schema.
- [ ] **T1.2** Implement the new query helpers in `server.js` with input validation and error mapping, then add integration tests that cover success and failure paths for `/period/status`, `/rpt/issue`, `/release`, and `/evidence`.
- [ ] **T1.3** Wrap the release flow in a database transaction and assert rollback on any OWA or state-update failure.

## 2. Implement tax calculations from authoritative schedules
- Swap the flat 20% PAYGW rate in `src/utils/paygw.ts` for logic that loads the official ATO withholding schedules, applies the correct brackets for the supplied pay period, and handles tax offsets and rounding rules.
- Ensure the GST utility mirrors actual BAS label definitions (e.g., 1A/1B) instead of returning mock values, and surface those labels through the evidence payload produced in `server.js` so downstream consumers can reconcile figures.

### Tasks
- [ ] **T2.1** Acquire current ATO PAYGW schedules and model them in a versioned data structure.
- [ ] **T2.2** Implement PAYGW calculation functions with unit tests covering representative pay scenarios.
- [ ] **T2.3** Replace GST mocks with label-aware calculations, cross-check against ATO BAS examples, and expose calculated PAYGW/GST values and labels through the evidence payload and front-end clients.

## 3. Wire real data ingestion and persistence
- Finish the persistence layer described in the README by filling out the missing migrations/tables that back `periods`, `rpt_tokens`, and the OWA ledger, then connect the payroll/POS adapters (`src/utils/payrollApi.ts`, `src/utils/posApi.ts`) to ingest live data instead of static mocks.
- Provide backfills or replay tooling so merkle roots and anomaly vectors referenced in the evidence response are computed from actual source events rather than placeholders.

### Tasks
- [ ] **T3.1** Author migrations for the periods, RPT tokens, and OWA ledger tables with indexes and foreign keys.
- [ ] **T3.2** Implement repository/service layers that persist issued RPTs, gate transitions, and ledger entries.
- [ ] **T3.3** Connect payroll/STP and POS ingestion adapters to real data feeds with validation and DLQ handling.
- [ ] **T3.4** Build a replay job that recomputes merkle roots and anomaly vectors from stored source events.

## 4. Security, controls, and compliance
- Replace the placeholder security posture called out in the README with MFA enforcement, encryption at rest/in transit, audit logging, and change-management processes that align with ATO DSP accreditation expectations.
- Move signing keys (`RPT_ED25519_SECRET_BASE64`) into a managed KMS or HSM service, establish rotation procedures, and document the operational evidence the ATO will expect (IR/DR drills, pen tests, privacy assessments).

### Tasks
- [ ] **T4.1** Implement MFA and role-based access controls on all high-risk routes, including step-up enforcement and segregation of duties.
- [ ] **T4.2** Enable structured audit logging with request IDs and tamper-evident storage.
- [ ] **T4.3** Integrate a managed KMS/HSM for key custody, rotation, and signing, updating all dependent services.
- [ ] **T4.4** Produce compliance artefacts: IR/DR drill reports, penetration test summaries, privacy impact assessment.

## 5. Operational readiness
- Stand up a rules-versioning pipeline so new ATO rates and schedules can be reviewed, approved, and activated without code deployments; failing to version rules today risks silent drift.
- Extend automated testing beyond the current static prototype—add migrations smoke tests, golden tests for PAYGW/GST outputs, and integration coverage that exercises seed → close → RPT → release → evidence flows end to end.

### Tasks
- [ ] **T5.1** Build a rules ingestion job with manual approval gates and automated diff alerts.
- [ ] **T5.2** Add golden tests that guard PAYGW/GST outputs against regression for each supported fiscal year.
- [ ] **T5.3** Create a CI smoke pipeline that seeds the database, runs end-to-end flows, and verifies evidence artefacts.
- [ ] **T5.4** Establish monitoring dashboards (metrics/traces/logs) and SLOs for release success, DLQ backlog, and rule drift.
