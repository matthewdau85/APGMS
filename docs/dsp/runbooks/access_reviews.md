# Access Review Runbook

## Objective
Ensure privileged and customer data access remains appropriate by conducting quarterly user access reviews aligned with DSP control expectations.

## Scope
- Production infrastructure accounts (AWS, CI/CD, observability tools).
- Application admin roles and finance/payment approval workflows.
- Shared services (Slack, Jira) where regulated data may transit.

## Roles
- **Review Owner:** Platform Lead.
- **Control Partner:** Security Lead (validates findings, approves remediation).
- **Record Keeper:** Compliance Analyst (maintains evidence register).

## Pre-Review Preparation (Week 0)
1. Export current access lists from IAM, Azure AD, application RBAC tables.
2. Generate segregation-of-duties (SoD) exception report for combined developer + deployer permissions.
3. Compile list of users with elevated finance approvals.
4. Create review packet in compliance evidence register with versioned timestamp.

## Review Execution (Week 1)
1. Distribute access list to each system owner for attestation (AWS, Database, Payments, Support tooling).
2. Require owners to mark each user as **Keep**, **Remove**, or **Change** with justification.
3. Capture approvals electronically (e.g., Jira workflow or signed PDF) within 5 business days.

## Remediation (Week 2)
1. For all **Remove** decisions, revoke access within 48 hours and capture change ticket reference.
2. For **Change** decisions, adjust role assignments and update SoD matrix.
3. Update central RBAC documentation and notify affected users.

## Evidence & Reporting
- Store exports, decisions, and change tickets in evidence repository.
- Summarise review outcomes (number of removals, exceptions) in quarterly DSP compliance forum.
- Track overdue remediation tasks in risk register until closure.

## Continuous Improvement
- Automate export scripts via Lambda functions where possible.
- Introduce anomaly detection for users whose access expands rapidly between reviews.
- Review runbook effectiveness annually and after any audit findings.
