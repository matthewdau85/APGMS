#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { resolveEnvConfig } from '../lib/config';
import { ServiceStage } from '../lib/service-stage';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new App();
const stageName = (app.node.tryGetContext('stage') as string) ?? 'staging';
const config = resolveEnvConfig(stageName);

new ServiceStage(app, `${config.name}-service`, {
  env: config.env,
  config
});

new PipelineStack(app, `${config.name}-pipeline`, {
  env: config.env,
  config
});
