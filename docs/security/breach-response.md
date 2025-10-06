# Security Incident and Breach Response

This service enforces the ATO DSP Operational Security Framework (OSF) baseline controls for
high-risk release actions. The following controls are in place:

- **JWT authentication and role checks** are required before sensitive handlers execute. Roles are
  expressed as scopes such as `release:execute`, `allowlist:write`, and `evidence:read`.
- **TOTP-based MFA step-up** is enforced on release, allow-list management, and evidence export.
  Clients must supply the current TOTP code in the `X-MFA-TOTP` header (or `mfaTotp` body field for
  non-GET requests). Codes are verified against the `MFA_TOTP_SECRET` environment variable.
- **Structured logging** attaches a generated `request_id`, hashed actor reference, and event type to
  every request, audit action, and security event. Logs are retained for the number of days specified
  by `LOG_RETENTION_DAYS` (defaults to 365) and the retention configuration is announced at startup.
- **Security headers and rate limits** protect sensitive endpoints. Repeated failures emit
  `security_event` log entries to surface suspicious patterns.

## Breach notification path

1. Security controls emit structured `security_event` log entries that include `request_id`, the
   hashed actor reference, and the triggering reason. Centralised monitoring should alert on these
   events in near real time.
2. Upon detecting a suspected breach, on-call staff must escalate immediately to the DSP security
   officer via the internal emergency channel (`#sec-incident`) and email (`security@apgms.local`).
3. The security officer coordinates triage, preserves logs for the configured retention period, and
   initiates the ATO breach notification workflow documented in the DSP OSF requirements. External
   notification to the ATO must occur within the mandated timeframe once impact is confirmed.
4. After containment, a post-incident review is recorded along with the correlated `request_id`
   values so that forensic teams can cross-reference database audit hashes.

Refer to the OSF overview and requirements artefacts in the ATO developer portal for the detailed
reporting obligations and timelines.
