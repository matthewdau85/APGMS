import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets';

export interface StagingEnvironmentStackProps extends cdk.StackProps {}

export class StagingEnvironmentStack extends cdk.Stack {
  public readonly clusterName: cdk.CfnOutput;
  public readonly serviceName: cdk.CfnOutput;
  public readonly vpcId: cdk.CfnOutput;
  public readonly dbSecretArn: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: StagingEnvironmentStackProps = {}) {
    super(scope, id, props);

    const key = new kms.Key(this, 'DataKey', {
      alias: 'alias/apgms/staging/data',
      enableKeyRotation: true
    });

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 3,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private-app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'private-data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }
      ]
    });

    const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: 'apgms/staging/database',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'appuser' }),
        generateStringKey: 'password',
        excludePunctuation: true
      },
      encryptionKey: key
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'RDS access from ECS only'
    });

    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      description: 'ECS tasks security group'
    });

    dbSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(5432), 'Allow ECS tasks to reach RDS');

    const rdsInstance = new rds.DatabaseInstance(this, 'Database', {
      vpc,
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.V15_3 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      vpcSubnets: { subnetGroupName: 'private-data' },
      multiAz: true,
      storageEncrypted: true,
      credentials: rds.Credentials.fromSecret(dbSecret),
      securityGroups: [dbSecurityGroup],
      allocatedStorage: 100,
      backupRetention: cdk.Duration.days(7),
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
      kmsKey: key,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      storageType: rds.StorageType.GP3,
      autoMinorVersionUpgrade: true
    });

    rdsInstance.addRotationSingleUser({
      automaticallyAfter: cdk.Duration.days(30),
      excludeCharacters: '"@/'
    });

    const repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'apgms-staging',
      encryption: ecr.RepositoryEncryption.KMS,
      encryptionKey: key,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }]
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsights: true
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });
    taskRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonXRayDaemonWriteAccess'));
    taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [dbSecret.secretArn]
    }));

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });
    executionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'));

    const logGroup = new logs.LogGroup(this, 'ServiceLogGroup', {
      logGroupName: '/apgms/staging/service',
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: key
    });

    const albFargate = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(repository, 'staging'),
        containerName: 'apgms-api',
        containerPort: 8080,
        executionRole,
        taskRole,
        environment: {
          NODE_ENV: 'staging',
          REQUEST_ID_HEADER: 'X-Request-Id',
          HEALTH_CHECK_PATH: '/healthz'
        },
        secrets: {
          DATABASE_SECRET: ecs.Secret.fromSecretsManager(dbSecret)
        },
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'apgms-api', logGroup })
      },
      desiredCount: 2,
      publicLoadBalancer: false,
      assignPublicIp: false,
      taskSubnets: { subnetGroupName: 'private-app' },
      securityGroups: [ecsSecurityGroup]
    });

    const loadBalancer = albFargate.loadBalancer;
    const listener = albFargate.listener;

    albFargate.targetGroup.configureHealthCheck({
      path: '/healthz',
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 2,
      timeout: cdk.Duration.seconds(5),
      interval: cdk.Duration.seconds(30)
    });

    repository.grantPull(taskRole);

    const httpApi = new apigwv2.HttpApi(this, 'StagingHttpApi', {
      apiName: 'apgms-staging-edge',
      createDefaultStage: true,
      corsPreflight: {
        allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowOrigins: ['*']
      }
    });

    const vpcLink = new apigwv2.VpcLink(this, 'VpcLink', {
      vpcLinkName: 'apgms-staging-link',
      vpc,
      subnets: { subnets: vpc.selectSubnets({ subnetGroupName: 'private-app' }).subnets },
      securityGroups: loadBalancer.connections.securityGroups
    });

    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new integrations.HttpAlbIntegration('AlbIntegration', listener, {
        vpcLink
      })
    });

    const waf = new wafv2.CfnWebACL(this, 'Waf', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'apgms-staging-waf',
        sampledRequestsEnabled: true
      },
      name: 'apgms-staging-waf',
      rules: [
        {
          name: 'AWS-AWSManagedRulesCommonRuleSet',
          priority: 0,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet'
            }
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSCommon',
            sampledRequestsEnabled: true
          },
          overrideAction: { none: {} }
        }
      ]
    });

    const apiDomain = cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint));
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.HttpOrigin(apiDomain, {
          originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: new cloudfront.OriginRequestPolicy(this, 'OriginRequestPolicy', {
          originRequestPolicyName: 'apgms-staging-headers',
          comment: 'Forward auth and request id headers',
          headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('Authorization', 'Content-Type', 'X-Request-Id'),
          queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
          cookieBehavior: cloudfront.OriginRequestCookieBehavior.all()
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      webAclId: waf.attrArn,
      enableLogging: true,
      logBucket: new s3.Bucket(this, 'AccessLogs', {
        encryption: s3.BucketEncryption.KMS,
        encryptionKey: key,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true
      })
    });

    const hostedZoneId = this.node.tryGetContext('hostedZoneId');
    const domainName = this.node.tryGetContext('domainName');
    if (hostedZoneId && domainName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId,
        zoneName: domainName
      });
      new route53.ARecord(this, 'AliasRecord', {
        zone,
        recordName: `staging.${domainName}`,
        target: route53.RecordTarget.fromAlias(new route53_targets.CloudFrontTarget(distribution))
      });
    }

    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: repository.repositoryUri,
      exportName: 'ApGmsStagingRepositoryUri'
    });

    this.clusterName = new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      exportName: 'ApGmsStagingCluster'
    });

    this.serviceName = new cdk.CfnOutput(this, 'ServiceName', {
      value: albFargate.service.serviceName,
      exportName: 'ApGmsStagingService'
    });

    this.vpcId = new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      exportName: 'ApGmsStagingVpc'
    });

    this.dbSecretArn = new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbSecret.secretArn,
      exportName: 'ApGmsStagingDbSecret'
    });

    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: distribution.distributionDomainName
    });

    new cdk.CfnOutput(this, 'HealthEndpoint', {
      value: `https://${distribution.distributionDomainName}/healthz`
    });

    new ssm.StringParameter(this, 'ObservabilityNamespace', {
      parameterName: '/apgms/staging/observability/namespace',
      stringValue: 'ApGms/Staging',
      description: 'CloudWatch namespace for staging metrics'
    });

    new logs.LogGroup(this, 'AccessLogGroup', {
      logGroupName: '/apgms/staging/edge',
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: key
    });
  }
}
