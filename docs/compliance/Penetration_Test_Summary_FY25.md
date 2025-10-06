# Penetration Test Executive Summary – FY25

- **Testing window:** 2025-07-08 to 2025-07-19
- **Provider:** RedShield Security (CREST ANZ accredited)
- **Scope:** External web portal, payments API, mobile companion app, privileged access pathways.

## Findings Overview
| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| High | 1 | Remediated (PT-2025-004) |
| Medium | 3 | In progress |
| Low | 6 | Accepted risk (documented) |

### High-Risk Issue (Remediated)
- **ID:** PT-2025-004
- **Description:** Insufficient rate limiting on `/api/release` step-up endpoint enabling MFA exhaustion.
- **Remediation:** Added adaptive throttling and CAPTCHA challenge in IdP; validated by retest on 2025-07-25.

### Medium-Risk Issues (Tracking)
1. **PT-2025-006** – Verbose error disclosure on reconciliation webhook (fix scheduled 2025-10-15).
2. **PT-2025-009** – Missing security headers for legacy marketing microsite (risk accepted until migration).
3. **PT-2025-011** – Outdated OS packages on bastion host (patched 2025-09-30, awaiting retest confirmation).

### Supporting Evidence
- Full report stored in evidence locker: `evidence_12345678901_2025-07_GST.json`.
- Retest confirmation e-mail archived in Confluence page SEC-PT-2025.

**Next scheduled test:** Q3 FY26 (booked for 2026-04-07).
