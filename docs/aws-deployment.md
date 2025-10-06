# AWS Deployment Guide – APGMS

This guide outlines the hardened AWS deployment path for APGMS, including infrastructure, pipelines, and operational practices.

## Infrastructure overview
- **Compute:** AWS Fargate ECS service in private subnets. Containers mount database credentials and mTLS materials from AWS Secrets Manager at runtime.
- **Data:** Amazon RDS for PostgreSQL provisioned in isolated subnets with security groups scoped to the ECS tasks.
- **Networking:** Dedicated VPC with segregated subnets, NAT gateway, and interface VPC endpoints for Secrets Manager and KMS to keep secret retrieval and envelope encryption inside AWS.
- **Edge:** Application Load Balancer enforces TLS using ACM certificates and expects an `x-mtls-authenticated` header (injected by CloudFront after validating client certificates). CloudFront distribution is protected by AWS WAF with managed rules and IP rate limiting.
- **Observability:** CloudWatch logging for ECS and RDS, plus WAF metrics.

See `infra/cdk` for CDK source.

## GitHub Actions pipeline
The workflow `.github/workflows/aws-staging.yml` provides a one-click path from commit to staged deployment:
1. **Build:** Install dependencies and build the app image defined in the repository `Dockerfile`.
2. **Test:** Execute `npm test --if-present` and `npm run lint --if-present` to guard regressions.
3. **Scan:**
   - Run Trivy against the container image; fail on high/critical findings.
   - Run Checkov on the synthesized CloudFormation templates to catch misconfigurations.
4. **Provision:** Use `cdk synth` and `cdk deploy` to apply infrastructure and service changes to the staging stack.

The workflow expects OIDC-backed AWS credentials stored as repository secrets and pushes the image to the ECR repository referenced in `infra/cdk/lib/config.ts`.

## AWS CodePipeline (optional)
For teams preferring managed AWS-native delivery, the CDK also defines an optional `PipelineStack`. Populate the `pipeline` block in `infra/cdk/lib/config.ts` with your CodeStar connection details to enable CodePipeline to run the same gates (build, tests, Trivy, Checkov) before deploying.

## Operations
- **Rollback:** Follow `infra/cdk/docs/rollback-runbook.md` to restore the last known-good version and re-enable automation safely.
- **Secret rotation:** Follow `infra/cdk/docs/secret-rotation.md` to rotate database and mTLS secrets without downtime.
- **Waivers:** If a scanner must be bypassed temporarily, document the rationale and expiry directly in the pipeline execution summary.

## Next steps
- Replace placeholder ARNs, CIDRs, and repository names with environment-specific values.
- Set up CloudWatch alarms for ECS task health and WAF anomalies.
- Integrate AWS Backup for automated database snapshots if compliance requires longer retention.
