# PayTo Banking Credential Configuration

The PayTo adapter writes to an audited queue so we can reconcile mandate lifecycle events, bank
references, and error codes against BAS gate requirements. Banking credentials are supplied through
environment variables so that each deployment stage can authenticate with the correct upstream
institution while keeping secrets outside of source control.

## Required environment variables

| Variable | Description |
| --- | --- |
| `PAYTO_BANK_PARTICIPANT_ID` | ISO 9362 / NPP participant identifier issued by the sponsor bank. |
| `PAYTO_BANK_CLIENT_ID` | OAuth client identifier for the PayTo channel. |
| `PAYTO_BANK_CLIENT_SECRET` | OAuth client secret. Store in your secret manager, not in `.env`. |
| `PAYTO_BANK_TLS_CERT` | Path to the mutual TLS client certificate used for PayTo calls. |
| `PAYTO_BANK_TLS_KEY` | Path to the private key that pairs with `PAYTO_BANK_TLS_CERT`. |
| `PAYTO_BANK_TLS_CA` | Path to the issuing CA bundle used to verify the bank endpoint. |
| `PAYTO_GATEWAY_URL` | Base URL for the bank's PayTo gateway (e.g. `https://bank-gw.sbox.payto.au`). |
| `BAS_GATE_RETRY_ATTEMPTS` | Optional override for the number of retries applied by the adapter. |
| `BAS_GATE_RETRY_DELAY_MS` | Optional override for the initial retry backoff in milliseconds. |
| `BAS_GATE_RETRY_MAX_DELAY_MS` | Optional override for the maximum retry backoff in milliseconds. |

The adapter automatically attaches the `PAYTO_BANK_PARTICIPANT_ID` and `PAYTO_BANK_CLIENT_ID` to each
queued event so that downstream workers can route messages to the correct credentials. Secrets such as
`PAYTO_BANK_CLIENT_SECRET` remain outside of the queue payload and should only be referenced by the
actual worker that dequeues and submits the transaction.

## Environment specific configuration

### Local development

1. Copy `ops/env/.payto.dev.example` (create this file if it does not exist) to `.env.local`.
2. Populate the values with the dedicated sandbox certificate and OAuth client assigned by your
   sponsor bank. For local testing you can point `PAYTO_GATEWAY_URL` to a stub server
   (for example the `apps/services/payments` service) and use self-signed certificates.
3. Load the environment using `source .env.local` before running `pnpm dev`.

### Staging / UAT

1. Store the credential set in your secret manager (e.g. Azure Key Vault, AWS Secrets Manager).
2. Reference the secrets from the deployment manifests:
   - Kubernetes: mount certificates as secrets and inject the client credentials through environment
     variables in the `Deployment` spec.
   - Docker Compose: use an `.env.staging` file that exports the variables above and mount the TLS
     material as read-only volumes.
3. Ensure `PAYTO_GATEWAY_URL` points to the bank's UAT endpoint and rotate credentials quarterly in
   accordance with the bank's security policy.

### Production

1. Require approval from the BAS gatekeeper before rotating credentials.
2. Store secrets in the production vault and mark them as "high sensitivity" so that access is
   audited.
3. Deploy credentials via your CI/CD secrets store; do not embed them into images. Mount the TLS
   material as read-only secrets, and point `PAYTO_GATEWAY_URL` to the bank's production PayTo
   gateway.
4. Set conservative retry controls by exporting `BAS_GATE_RETRY_ATTEMPTS`,
   `BAS_GATE_RETRY_DELAY_MS`, and `BAS_GATE_RETRY_MAX_DELAY_MS` in keeping with the bank's rate limit
   contract. These values flow straight into the adapter's exponential backoff logic.

## Verifying configuration

Run the following once credentials are in place:

```bash
pnpm tsx scripts/check-payto-credentials.ts
```

The script should confirm that TLS material, OAuth credentials, and the participant identifier are
present. The adapter itself will refuse to enqueue events if the TLS files are unreadable or the
participant identifier is missing, ensuring misconfigurations are caught during deployment rehearsals.
