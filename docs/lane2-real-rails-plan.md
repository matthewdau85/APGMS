# Lane 2 Real Rails Implementation Plan

This document outlines the proposed implementation steps for the Lane 2 "real" provider rollout across the payments stack. The focus is on landing production-ready adapters without disrupting existing mock integrations.

## R1. Real KMS/HSM adapter behind `KmsPort`

* Implement a new `@providers/kms/real` package that wraps the selected cloud KMS (AWS KMS to start) via the existing `KmsPort` contract.
* Preserve the current JWS configuration (RS256) and continue emitting key identifiers using the existing structure so downstream consumers do not need to change.
* Rotation should be delegated to the KMS provider. We will surface rotation metadata through the adapter so that the scheduler can trigger refreshes in line with provider guidance.
* JWKS will be persisted in the signed object store used by downstream services; the adapter will be responsible for keeping the cache in sync post-rotation.
* Anti-replay remains a shared service across mock and real implementations—no changes required besides wiring the real signer into the validation pipeline.

## R2. Authoritative rates bundle behind `RatesPort`

* Introduce a `rates/real` adapter that reads signed PAYGW/GST bundle artifacts from the evidence store.
* Artifacts will be versioned and checksummed; the adapter validates signatures and the checksum before exposing the bundle through `RatesPort`.
* The adapter must emit the same structure as the current mock implementation to keep contract tests stable. Version selection is handled through configuration and evidence metadata.
* Evidence handling will surface the checksum in release evidence (RPT) to prove integrity.

## R3. Bank egress & statements (real adapter)

* Add a `bank/real` adapter that maps provider-specific payout responses into the canonical `PayoutResult` domain model. Provider codes are normalised to our standard taxonomy.
* Cut-off handling is unified by projecting provider schedules into our canonical timetable and surfacing a single decision per transfer request.
* Statement ingestion is performed via SFTP/API feeds and streamed into `BankStatementsPort`, applying the existing reconciliation rules to ensure statement lines align with payouts.

## R4. Identity & MFA (minimal, real)

* Integrate the selected IdP (Keycloak/Auth0) behind `IdentityPort`, introducing role mapping for `operator`, `auditor`, and `approver`.
* Privileged actions (approvals) must enforce MFA. We will reuse the IdP session context, requiring a recent MFA assertion before allowing approval workflows to proceed.
* Backend services will enforce role checks and MFA freshness before executing privileged operations.

## R5. Shadow mode & capability gate

* Implement a `SHADOW_MODE=true` configuration that invokes both mock and real adapters. Responses are compared, but only the mock result is returned to callers.
* Discrepancies are logged and stored for analysis. We will establish a threshold for acceptable mismatches and promote providers once the shadow run is stable.
* `/health/capabilities` will expose readiness for each provider. The deployment pipeline must verify this endpoint reports all providers "ready" before enabling real mode.

## Next Steps

1. Stub adapters and ports in the codebase to make room for real implementations.
2. Extend contract tests to exercise both mock and real adapters.
3. Wire capability reporting into the service health endpoint.
4. Implement rotation scheduling and evidence publication.

This plan will be refined as the real integrations are developed and tested.
