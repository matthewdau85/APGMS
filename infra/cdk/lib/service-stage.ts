import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from './config';
import { ServiceStack } from './service-stack';
import { EdgeStack } from './edge-stack';

export interface ServiceStageProps extends StageProps {
  readonly config: EnvConfig;
}

export class ServiceStage extends Stage {
  public readonly serviceStack: ServiceStack;

  public constructor(scope: Construct, id: string, props: ServiceStageProps) {
    super(scope, id, props);

    this.serviceStack = new ServiceStack(this, 'ServiceStack', {
      env: props.config.env,
      config: props.config
    });

    new EdgeStack(this, 'EdgeStack', {
      env: props.config.env,
      config: props.config,
      originLoadBalancer: this.serviceStack.loadBalancer
    });
  }
}
