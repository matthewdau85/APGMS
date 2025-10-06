import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as pipelines from 'aws-cdk-lib/pipelines';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import { StagingStage } from './staging-stage';

export interface StagingPipelineStackProps extends cdk.StackProps {
  readonly repoString?: string;
  readonly branch?: string;
  readonly connectionArn?: string;
}

export class StagingPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StagingPipelineStackProps = {}) {
    super(scope, id, props);

    const repoString = props.repoString ?? this.node.tryGetContext('repository') ?? 'apgms/apgms';
    const branch = props.branch ?? this.node.tryGetContext('branch') ?? 'main';
    const connectionArn = props.connectionArn ?? this.node.tryGetContext('connectionArn') ?? 'arn:aws:codestar-connections:region:account-id:connection/placeholder';

    const source = pipelines.CodePipelineSource.connection(repoString, branch, {
      connectionArn,
    });

    const synthStep = new pipelines.ShellStep('Synth', {
      input: source,
      commands: [
        'npm install -g aws-cdk',
        'cd infra/cdk',
        'npm ci',
        'npm run build',
        'npx cdk synth'
      ],
      primaryOutputDirectory: 'infra/cdk/cdk.out'
    });

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'ApGmsStagingPipeline',
      synth: synthStep,
      dockerEnabledForSelfMutation: true,
      dockerEnabledForSynth: true,
      crossAccountKeys: false
    });

    const stagingStage = new StagingStage(this, 'Staging', {
      env: props.env,
    });

    const buildScanTest = new pipelines.CodeBuildStep('BuildScanTest', {
      input: source,
      partialBuildSpec: pipelines.CodeBuildStep.partialBuildSpec({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'npm install -g npm@latest',
              'npm install -g trivy checkov'
            ]
          },
          pre_build: {
            commands: [
              'aws --version',
              'ECR_URI=$(aws ecr describe-repositories --repository-names apgms-staging --query "repositories[0].repositoryUri" --output text 2>/dev/null)',
              'if [ -z "$ECR_URI" ] || [ "$ECR_URI" = "None" ]; then echo "ECR repository missing: ensure infra deployed" && exit 1; fi',
              'echo "ECR_URI=$ECR_URI"'
            ]
          },
          build: {
            commands: [
              'IMAGE_TAG=$(git rev-parse --short=12 HEAD)',
              'export IMAGE_TAG',
              'aws ecr get-login-password | docker login --username AWS --password-stdin "$ECR_URI"',
              'docker build -t "$ECR_URI:$IMAGE_TAG" -t "$ECR_URI:staging" .',
              'trivy image --no-progress "$ECR_URI:$IMAGE_TAG"',
              'checkov -d .',
              'npm ci',
              'npm test',
              'docker push "$ECR_URI:$IMAGE_TAG"',
              'docker push "$ECR_URI:staging"',
              'mkdir -p infra/artifacts',
              'echo $IMAGE_TAG > infra/artifacts/image-tag.txt'
            ]
          }
        },
        artifacts: {
          'base-directory': 'infra/artifacts',
          files: ['image-tag.txt']
        }
      }),
      buildEnvironment: {
        privileged: true,
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0
      },
      rolePolicyStatements: [
        new iam.PolicyStatement({
          actions: [
            'ecr:GetAuthorizationToken',
            'ecr:BatchCheckLayerAvailability',
            'ecr:CompleteLayerUpload',
            'ecr:UploadLayerPart',
            'ecr:InitiateLayerUpload',
            'ecr:PutImage',
            'ecr:DescribeRepositories'
          ],
          resources: ['*']
        }),
        new iam.PolicyStatement({
          actions: ['iam:PassRole'],
          resources: ['*']
        })
      ],
      primaryOutputDirectory: 'infra/artifacts'
    });

    const deployStep = new pipelines.CodeBuildStep('DeployToStaging', {
      input: buildScanTest,
      envFromCfnOutputs: {
        CLUSTER_NAME: stagingStage.clusterName,
        SERVICE_NAME: stagingStage.serviceName,
        VPC_ID: stagingStage.vpcId,
        DB_SECRET_ARN: stagingStage.dbSecretArn
      },
      commands: [
        'IMAGE_TAG=$(cat image-tag.txt)',
        'npm install -g aws-cdk',
        'cd infra/cdk',
        'npm ci',
        'npm run build',
        'npx cdk deploy ApGmsStaging/StagingEnvironmentStack --require-approval never',
        'aws ecs update-service --cluster "$CLUSTER_NAME" --service "$SERVICE_NAME" --force-new-deployment',
        'aws cloudwatch put-metric-data --namespace "ApGms/Staging" --metric-name "LastDeployedImage" --value 1 --dimensions ImageTag=$IMAGE_TAG',
        'aws secretsmanager describe-secret --secret-id "$DB_SECRET_ARN"'
      ],
      buildEnvironment: {
        privileged: true,
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0
      },
      rolePolicyStatements: [
        new iam.PolicyStatement({
          actions: ['ecs:UpdateService', 'ecs:DescribeServices'],
          resources: ['*']
        }),
        new iam.PolicyStatement({
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*']
        }),
        new iam.PolicyStatement({
          actions: ['secretsmanager:DescribeSecret'],
          resources: ['*']
        })
      ]
    });

    pipeline.addStage(stagingStage, {
      pre: [buildScanTest],
      post: [deployStep]
    });
  }
}
