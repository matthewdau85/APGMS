# Readiness Scorecard (v1.0)

Generated: 2025-10-06T17:22:52.265Z
App Mode: prototype

### Prototype (0/10)
| Check | Status | Points | Max | Details |
| --- | --- | --- | --- | --- |
| prototype.rails_sim | ❌ | 0 | 2 | GET /sim/rail failed (0): READINESS_BASE_URL not configured |
| prototype.evidence_v2 | ❌ | 0 | 2 | Unable to fetch evidence for latest: READINESS_BASE_URL not configured |
| prototype.rules_correct | ❌ | 0 | 2 | Rules correctness gaps: PAYGW/GST golden tests, RATES_VERSION, RULES_MANIFEST_SHA256 |
| prototype.security_thin | ❌ | 0 | 1 | Security controls missing: /release without JWT, real mode MFA, dual approval |
| prototype.observability | ❌ | 0 | 1 | Observability gaps: healthz, metrics, x-request-id |
| prototype.seed_smoke | ❌ | 0 | 1 | Seed/smoke tooling missing: scripts/seed, scripts/smoke |
| prototype.help_docs | ❌ | 0 | 1 | Help coverage script missing |

### Real (0/10)
| Check | Status | Points | Max | Details |
| --- | --- | --- | --- | --- |
| real.kms_rpt | ❌ | 0 | 2 | KMS readiness gaps: env KMS keys, rotation artifact, /rpt/health kms:true |
| real.sandbox_rail | ❌ | 0 | 2 | Sandbox rail gaps: mTLS envs, provider_ref persistence, recon import settlement link |
| real.security_controls | ❌ | 0 | 2 | Security control gaps: security headers, rate limit, PII redaction |
| real.assurance | ❌ | 0 | 2 | Assurance artifacts missing: vuln-scan.md, ir-notes.md, dr-notes.md |
| real.pilot_ops | ❌ | 0 | 2 | Pilot ops gaps: /ops/slo data, runbooks |

**Prototype:** FAIL (threshold 6) | **Real:** FAIL (threshold 6)
