# APGMS
Skeleton monorepo for Automated PAYGW & GST Management System.
See ADRs in /docs/adr and architecture diagrams in Mermaid in /docs/diagrams.

## Deployment configuration

The Reconciliation & Payments Token (RPT) issuer requires an Ed25519 signing secret.
Set `RPT_ED25519_SECRET_BASE64` to the base64-encoded 64-byte secret key before
starting the service in any production-like environment. The local development
server will fall back to `.env.rpt.fixture`, but production deployments **must**
provide the environment variable explicitly to avoid start-up failures.
