# APGMS Staging Environment CDK App

This package defines the hardened staging environment for APGMS using the AWS Cloud Development Kit (CDK).

## Architecture highlights

- **Network** – Multi-AZ VPC with isolated data subnets, private application subnets, a single NAT gateway, and locked-down security groups.
- **Compute** – ECS Fargate service (two tasks minimum) fronted by an internal Application Load Balancer, exposed publicly via Amazon API Gateway (HTTP API) and Amazon CloudFront protected with AWS WAF. Request IDs provided by clients are forwarded end-to-end via CloudFront origin request policies and API Gateway integration.
- **Data** – Amazon RDS for PostgreSQL instance encrypted with a dedicated KMS key. Credentials are generated and rotated automatically in AWS Secrets Manager.
- **Secrets & Encryption** – Dedicated KMS CMK encrypts RDS, Secrets Manager, CloudWatch Logs, and S3 access logs. Secrets are injected into the workload as task secrets.
- **Observability** – CloudWatch log groups, ECS Container Insights, X-Ray permissions, and a parameterized namespace for custom metrics ensure metrics and traces are ingested automatically. The service publishes a `/healthz` endpoint consumed by load balancer and pipeline smoke checks.
- **Pipeline** – A CDK Pipelines based CodePipeline provides build → scan (Trivy + Checkov) → test → deploy automation. Artifacts land in Amazon ECR before deployment, and ECS is forced to pull the freshly scanned `staging` tag on each rollout.

## Usage

```bash
npm install -g aws-cdk
cd infra/cdk
npm install
npm run build
cdk synth
cdk deploy ApGmsStagingPipeline \
  --context account=123456789012 \
  --context region=us-east-1 \
  --context repository=apgms/apgms \
  --context branch=main \
  --context connectionArn=arn:aws:codestar-connections:us-east-1:123456789012:connection/abc123
```

The pipeline deploys a `Staging` stage that provisions infrastructure and then continuously delivers container revisions. Provide optional `hostedZoneId` and `domainName` contexts to create a `staging.<domain>` alias for the CloudFront distribution.

## Health verification

The service publishes `https://<distribution-domain>/healthz`. The pipeline deploy step runs ECS force-new-deployment and emits a custom metric (`ApGms/Staging`, `LastDeployedImage`) that can be tracked for deployment validation. X-Ray permissions enable distributed tracing when the application runs the X-Ray SDK.
