# Privacy Impact Assessment – FY25 Enhancements

**Prepared by:** Privacy Officer (PO-Analytics)
**Assessment Date:** 2025-08-12

## Scope
- New anomaly detection telemetry storing payroll variance vectors.
- Expansion of evidence locker retention to 7 years.
- Integration with third-party debt collection notifications.

## APP & Privacy Act Considerations
1. **APP 1 (Open and transparent management of personal information)**
   - Updated privacy policy to include automated decisioning explanation for anomaly detection (published 2025-08-20).
2. **APP 6 (Use or disclosure)**
   - Debt collection notifications constrained to entities with signed DSP data sharing deeds. Data shared limited to ABN, outstanding amount, and contact details.
3. **APP 11 (Security of personal information)**
   - Encryption at rest via KMS-integrated storage; residual risk rated LOW after compensating controls (MFA, audit logging).
4. **Tax File Number (TFN) Rule compliance**
   - TFN data tokenised before export; access restricted to `privacy:tfn` role and logged.

## Risk Assessment
| Risk | Likelihood | Impact | Rating | Treatment |
|------|------------|--------|--------|-----------|
| Unauthorised access to anomaly telemetry | Unlikely | Moderate | Medium | Segmented storage + RBAC, quarterly access review |
| Over-retention in evidence locker | Possible | Minor | Low | Lifecycle policy to delete after 7 years, automated job validated |
| Misrouting of debt notifications | Rare | Major | Medium | Dual approval workflow and templated notifications |

## Recommendations
- [x] Implement privacy-aware logging filter (completed 2025-09-05).
- [ ] Conduct DPIA refresh if third-party notification scope expands (trigger: >5 partners).

**Approval:** Chief Privacy Officer (signed 2025-08-28).
