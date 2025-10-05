# ATO DSP Compliance Gap Analysis

## Context
The current APGMS codebase does not implement the security controls required for
ATO Digital Service Provider (DSP) accreditation. This document records the
known gaps identified during an initial assessment and outlines the work needed
before compliance can be demonstrated.

## Multi-Factor Authentication (MFA), RBAC, and Audit Trails
- **Gap:** No MFA workflows or token verification logic exist for the admin or
  operator endpoints. Authentication remains single-factor and session-based.
- **Gap:** Role-based access control (RBAC) is not enforced in the API layer.
  Endpoints rely on ad-hoc authorization checks or lack them entirely.
- **Gap:** Comprehensive audit trails are absent. Existing logging does not
  capture who performed sensitive administrative actions, nor are entries stored
  in an immutable/tamper-evident fashion.
- **Required Work:** Introduce MFA enrolment and challenge flows, define RBAC
  policies and enforcement middleware, and implement append-only audit trails
  for administrative actions. Update policy documentation accordingly.

## Secret Management and Transport Security
- **Gap:** Secrets for `rptGate` and `bank-egress` services are sourced from
  development configuration artifacts instead of a managed Key Management
  Service (KMS).
- **Gap:** Inter-service communication relies on plaintext HTTP and shared
  networks without enforced TLS or mutual TLS (mTLS).
- **Required Work:** Integrate a managed KMS provider for secret retrieval and
  rotation, refactor services to consume those keys at runtime, and mandate TLS
  (preferably mTLS) for all internal service-to-service connections.

## Logging and Evidence Collection
- **Gap:** Logging does not currently produce tamper-evident evidence (e.g.,
  hash chains) nor capture operator override events required for an Authority to
  Operate (ATO) review.
- **Required Work:** Extend logging pipelines to include cryptographic hash
  chaining, operator identity capture, and secure archival storage. Ensure
  tooling can generate evidence packages for accreditation reviews.

## Compliance Documentation and Automated Checks
- **Gap:** There is no documented compliance matrix mapping ATO DSP
  requirements to implemented controls, and automated tests do not verify
  compliance evidence.
- **Required Work:** Develop compliance documentation, add automated checks to
  CI/CD that validate control implementation status, and maintain versioned
  evidence demonstrating ongoing adherence.

## Summary
Significant engineering and documentation effort is required before APGMS can
meet ATO DSP accreditation requirements. The above gaps must be addressed prior
to any compliance assertion.
