import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ShellStep, ManualApprovalStep } from 'aws-cdk-lib/pipelines';
import { EnvConfig } from './config';
import { ServiceStage } from './service-stage';

export interface PipelineStackProps extends StackProps {
  readonly config: EnvConfig;
}

export class PipelineStack extends Stack {
  public constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const { config } = props;
    if (!config.pipeline) {
      return;
    }

    const synthStep = new ShellStep('Synth', {
      input: CodePipelineSource.connection(config.pipeline.repository, config.pipeline.branch, {
        connectionArn: config.pipeline.connectionArn
      }),
      commands: [
        'npm ci',
        'npm run lint --if-present',
        'npm run test --if-present',
        'docker build -t $CODEBUILD_RESOLVED_SOURCE_VERSION .',
        'curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin',
        'trivy image --scanners vuln --exit-code 1 --severity HIGH,CRITICAL $CODEBUILD_RESOLVED_SOURCE_VERSION',
        'pip install checkov',
        'npm install --prefix infra/cdk',
        'npm run --prefix infra/cdk lint',
        'npm run --prefix infra/cdk build',
        'npm run --prefix infra/cdk synth'
      ],
      primaryOutputDirectory: 'infra/cdk/cdk.out'
    });

    const pipeline = new CodePipeline(this, 'Pipeline', {
      synth: synthStep,
      crossAccountKeys: false,
      dockerEnabledForSynth: true
    });

    const stage = new ServiceStage(this, `${config.name}-stage`, {
      env: config.env,
      config
    });

    pipeline.addStage(stage, {
      pre: [
        new ShellStep('CheckovScan', {
          commands: ['checkov -d infra/cdk/cdk.out']
        }),
        new ManualApprovalStep('PromoteToDeploy', {
          comment: 'Confirm staging deployment gate after scans'
        })
      ]
    });
  }
}
