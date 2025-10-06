# APGMS AWS Infrastructure (CDK)

This package provides an AWS CDK (TypeScript) application that provisions an AWS Fargate deployment hardened with private networking, managed secrets, CloudFront + WAF edge protection, and a CI/CD pipeline. The defaults focus on the staging environment but can be extended for production via `lib/config.ts`.

## Layout

- `bin/apgms-infra.ts` – CDK entrypoint supporting context-based environment selection.
- `lib/service-stack.ts` – Core VPC, security groups, Secrets Manager secrets, RDS, and ECS Fargate service with mTLS material pulled from Secrets Manager at runtime.
- `lib/edge-stack.ts` – CloudFront distribution fronting the internal ALB with managed WAF rules and rate limiting.
- `lib/pipeline-stack.ts` – AWS CodePipeline definition that runs quality gates (tests, Trivy, Checkov) before deploying to the selected stage.
- `lib/config.ts` – Declarative environment configuration that should be updated with real account IDs, regions, domain names, ACM certificates, and repository connection details.

## Usage

```sh
# Install dependencies
npm install --prefix infra/cdk

# Bootstrap CDK (once per account/region)
npx cdk bootstrap aws://<account>/<region>

# Synthesize CloudFormation
npm run --prefix infra/cdk synth -- --context stage=staging

# Deploy to staging (requires AWS credentials with appropriate IAM privileges)
npm run --prefix infra/cdk deploy -- --require-approval never --context stage=staging
```

## Required manual configuration

1. **ACM certificates** – Update `lib/config.ts` with the ACM ARNs for the Application Load Balancer (regional) and CloudFront (us-east-1). Certificates must include the public endpoint hostnames.
2. **Secrets Manager mTLS bundle** – Upload the PEM-encoded client CA, server certificate, and key to a JSON secret that matches the keys declared in the config. The container retrieves these at runtime and the ALB enforces mTLS via the `x-mtls-authenticated` header injected by CloudFront.
3. **GitHub/AWS CodeStar connection** – Populate `config.pipeline` with the CodeStar connection ARN, repository, and branch to allow the managed pipeline to pull source code.
4. **ECR image** – Ensure the referenced image exists and is built by the CI workflow (see `.github/workflows/aws-staging.yml`).

## Security defaults

- VPC endpoints for KMS and Secrets Manager avoid internet egress for secret retrieval and envelope encryption.
- Database credentials and TLS material live in Secrets Manager; no plaintext secrets are embedded in task definitions.
- Security groups restrict traffic to the minimal blast radius (ALB <-> ECS, ECS <-> RDS).
- RDS retains snapshots on deletion for safer rollback.
- CloudFront attaches an AWS Managed rule set and rate limiting while injecting an mTLS enforcement header to the private ALB origin.
- Pipelines include container and IaC scanning with explicit failure on high/critical findings.

See `docs/` for operational runbooks (rollback, secret rotation).
