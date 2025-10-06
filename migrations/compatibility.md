# Compatibility Rules for v1.x Contracts

## Overview
The `schema_version` field is now included in every public contract exposed via HTTP and NATS. All producers must set the
field and all consumers must validate it. Implementations MUST accept the current major version (`v1`) and the immediately-next
major version (`v2`) to guarantee zero-downtime upgrades.

## HTTP APIs
- **Endpoints**: `/deposit`, `/payAto`, `/balance`, `/ledger`.
- **Versioning**: Clients MUST send `schema_version` in the request body (POST) or query string (GET). Servers echo the version in
  the response payload.
- **Evolution rules**:
  - Only additive fields may be introduced to requests or responses in the `v1.x` series.
  - Newly added fields MUST be optional for existing clients and documented in the corresponding JSON Schema file under
    `schemas/http`.
  - Field removals, type changes, or semantic repurposing are **not** permitted until a new major version (e.g. `v2`) is published.

## NATS Topics
- **Subjects**: `apgms.normalized.v1`, `apgms.tax.v1`.
- **Versioning**: Published messages include `schema_version`. Consumers must accept `v1` and `v2` during the `v1.x` lifecycle.
- **Evolution rules**:
  - Additive payload changes (new optional attributes) are allowed.
  - Breaking changes (removing fields, changing types, or altering meaning) require publishing to a new subject and schema
    version.
  - JSON Schemas live in `schemas/nats` and must be updated alongside any additive change.

## Change Management Checklist
1. Update the relevant JSON Schema file in `/schemas`.
2. Extend automated compatibility tests (e.g. `apps/services/payments/test/compat.test.ts`) to cover the new optional fields.
3. Ensure mock adapters, SDKs, and production adapters are tolerant of `v1` and `v2` payloads.
4. Document the change in release notes and notify integrators before promoting to production.
