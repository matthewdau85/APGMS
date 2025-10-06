# Rollback Runbook – APGMS AWS Deployment

## Preconditions
- Obtain AWS credentials with permissions to interact with CloudFormation, ECS, ECR, and RDS snapshots in the target account.
- Confirm the failing deployment via the pipeline execution history (CodePipeline console) and capture the execution ID for audit.

## 1. Freeze the pipeline
1. Navigate to the `Apgms` CodePipeline in the AWS Console.
2. Disable the pipeline or stop the in-flight execution to prevent automatic redeployments.

## 2. Identify the last known-good revision
1. Use `aws codepipeline get-pipeline-state --name <pipeline-name>` to determine the last successful commit SHA deployed to staging.
2. Confirm the associated container image in ECR (tagged with the commit SHA from the workflow).

## 3. Revert the service
1. Deploy the previous CloudFormation template artifact from S3 or re-run the pipeline for the specific commit:
   ```sh
   aws codepipeline start-pipeline-execution --name <pipeline-name> --source-revisions commitId=<sha>
   ```
2. Alternatively, run `cdk deploy` locally using the same commit:
   ```sh
   git checkout <sha>
   npm install --prefix infra/cdk
   npm run --prefix infra/cdk deploy -- --require-approval never --context stage=staging
   ```
3. Monitor the CloudFormation stack events until status is `UPDATE_COMPLETE`.

## 4. Database considerations
- The RDS instance retains snapshots on update/delete. If schema changes were applied, restore the most recent automated snapshot to a new instance and promote after validation.
- Use AWS DMS or native PostgreSQL `pg_dump/pg_restore` to reseed if needed.

## 5. Re-enable traffic
1. Validate application health via `/healthz` endpoint through CloudFront.
2. Re-enable the CodePipeline and rerun the latest good execution to ensure automation is intact.
3. Document the incident in the operations log with cause, fix, and prevention steps.

## 6. Post-rollback hardening
- Add automated tests or alarms that would have caught the regression.
- Update the pipeline waivers if a scanner finding required manual suppression.
