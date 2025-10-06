# Separation of Duties Workflow

High-value releases (>= `RELEASE_DUAL_APPROVAL_CENTS`, default $100k) require two approvals before execution.

## Roles
- **Operator**: initiates release requests.
- **Approver**: reviews and approves release payloads.
- **Admin**: may perform either function and manage allow-list entries.

## Workflow
1. Operator requests a release via `POST /api/pay`.
2. System computes the release hash from `{abn, taxType, periodId, amountCents}`.
3. Approvers submit approvals:
   ```json
   POST /api/approvals/releases
   {
     "abn": "12345678901",
     "taxType": "GST",
     "periodId": "2025-Q1",
     "amountCents": 25000000,
     "reason": "Matched to BAS statement"
   }
   ```
4. Middleware verifies at least two distinct approvers (excluding the release actor) have approved within `RELEASE_APPROVAL_TTL_MINUTES` (default 240).
5. If requirements met, release proceeds; otherwise 403 is returned with the current approver list.

Approvals are stored in `release_approvals` and are linked to audit entries for traceability.
