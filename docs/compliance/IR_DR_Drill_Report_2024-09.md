# Incident Response & Disaster Recovery Drill – September 2024

**Scenario:** Coordinated ransomware attack encrypting application nodes and attempting to exfiltrate PAYGW/GST datasets.

- **Date executed:** 2024-09-17
- **Participants:** Security Operations (on-call), Platform SRE, Treasury Operations, Privacy Officer.
- **RTO/RPO targets:** RTO 4h, RPO 15m (DSP 5.1)

## Timeline
| Time (AEST) | Event |
|-------------|-------|
| 09:00 | Tabletop kick-off, threat intel briefing. |
| 09:20 | Simulated detection via SIEM alert (“multiple failed MFA + anomalous encryption process”). |
| 09:30 | IR lead invoked playbook `IR-CRYPTOLOCK-01`; containment actions issued. |
| 09:45 | Backup restoration triggered from immutable S3 snapshots (15 min point-in-time). |
| 10:40 | Application restored in clean environment; integrity validated via hash comparison of `rpt_tokens` payloads. |
| 11:05 | Treasury Operations confirmed ability to continue daily sweeps; ATO notified per DSP breach protocol. |
| 11:30 | Post-mortem scheduled; evidence bundle exported (`evidence_12345678901_2024-09_GST.json`). |

## Outcomes
- **RTO achieved:** 1h40m (met objective)
- **RPO achieved:** 12m (met objective)
- **Gaps identified:**
  1. Need automated revocation of compromised service accounts (tracked as SEC-2471).
  2. Update privacy notification templates for joint ATO/Office of the Australian Information Commissioner (OAIC) communication.

## Follow-up Actions
- [x] Deploy automated credential revocation Lambda (due 2024-10-01).
- [x] Update SIEM detection to escalate chained MFA failures (completed 2024-09-22).
- [ ] Roll new privacy comms template through Legal review (due 2024-10-15).

**Approval:** Head of Security (signed 2024-09-20).
