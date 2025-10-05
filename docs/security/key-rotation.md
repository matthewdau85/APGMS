# Key Rotation Runbook

## Scope
This runbook covers rotation of the shared development HMAC key (`SERVICE_SIGNING_KEY`) and Auth0/Keycloak client secrets used by the APGMS prototype.

## Preconditions
- Confirm new secrets have been provisioned in the dev tenant / secret store.
- Notify operators of pending maintenance window (rotation requires brief service restart).
- Ensure SBOM + dependency audit CI pipeline is green before changes.

## Rotation Steps
1. **Generate new material**
   - For `SERVICE_SIGNING_KEY`, create a 256-bit random value (`openssl rand -hex 32`).
   - For Auth0/Keycloak, create a new client secret with MFA enforced for affected applications.
2. **Update secret store**
   - Write the new values to the development secrets backend (`.env` in dev only). Keep the previous secret as `SERVICE_SIGNING_KEY_PREV` for overlap.
3. **Deploy**
   - Restart API gateway and payments service processes to pick up the new secrets. Runtime validation will abort if secrets are missing.
4. **Dual signature overlap**
   - For 15 minutes, accept requests signed with either `SERVICE_SIGNING_KEY` or `SERVICE_SIGNING_KEY_PREV` to drain inflight jobs. (Implement by setting both env vars and updating middleware to check both values.)
5. **Cutover**
   - Remove `SERVICE_SIGNING_KEY_PREV` after overlap window. Redeploy to ensure only the new key is active.
6. **Audit**
   - Confirm request logs show successful signatures post-rotation and no repeated `INVALID_SERVICE_SIGNATURE` errors.
   - Record rotation event in compliance log referencing audit export entry IDs.

## Emergency Rotation
- If compromise suspected, immediately revoke the client secret and regenerate `SERVICE_SIGNING_KEY`. Skip overlap and invalidate all outstanding sessions.
- Force re-authentication in Auth0/Keycloak by toggling client credentials and requiring MFA re-challenge.

## Post-Rotation Checklist
- ✅ New secrets stored securely and documented.
- ✅ Services restarted without runtime validation failures.
- ✅ Audit log entry created with rotation metadata.
- ✅ CI security workflow completed after rotation.
