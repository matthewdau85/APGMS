#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StagingPipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();

const env = {
  account: app.node.tryGetContext('account') || process.env.CDK_DEFAULT_ACCOUNT,
  region: app.node.tryGetContext('region') || process.env.CDK_DEFAULT_REGION,
};

new StagingPipelineStack(app, 'ApGmsStagingPipeline', {
  env,
});
