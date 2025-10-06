# Pilot Metrics Definitions

## On-Time BAS Submission Rate
- **Definition:** Percentage of Business Activity Statements lodged on or before the statutory due date during the pilot period.
- **Formula:** (Number of BAS submitted on time ÷ Total BAS due in period) × 100.
- **Data Sources:** APGMS submission timestamps, ATO due date schedule, customer confirmation of lodgement.

## Arrears Dollar Exposure
- **Definition:** Total outstanding tax liability (in AUD) tied to overdue BAS obligations for entities in scope.
- **Formula:** Sum of unpaid BAS balances aged beyond due date at each weekly checkpoint.
- **Data Sources:** General ledger balance, ATO arrears statements, APGMS arrears tracking module.

## Review Duration
- **Definition:** Average elapsed time from BAS workpaper preparation to reviewer sign-off for each cycle.
- **Formula:** Mean of (review completion timestamp − review start timestamp) across BAS in scope.
- **Data Sources:** APGMS workflow logs, reviewer checklist completion records.

## Anomaly Rate
- **Definition:** Share of reconciled transactions flagged as anomalies by APGMS automation.
- **Formula:** (Number of anomaly-flagged transactions ÷ Total transactions reviewed) × 100.
- **Data Sources:** APGMS anomaly logs, reconciliation datasets imported during pilot.
