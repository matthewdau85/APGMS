import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StagingEnvironmentStack } from './staging-stack';

export interface StagingStageProps extends cdk.StageProps {}

export class StagingStage extends cdk.Stage {
  public readonly clusterName: cdk.CfnOutput;
  public readonly serviceName: cdk.CfnOutput;
  public readonly vpcId: cdk.CfnOutput;
  public readonly dbSecretArn: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: StagingStageProps) {
    super(scope, id, props);

    const stack = new StagingEnvironmentStack(this, 'StagingEnvironmentStack', {
      env: props.env,
      stackName: 'ApGmsStaging-StagingEnvironmentStack'
    });

    this.clusterName = stack.clusterName;
    this.serviceName = stack.serviceName;
    this.vpcId = stack.vpcId;
    this.dbSecretArn = stack.dbSecretArn;
  }
}
