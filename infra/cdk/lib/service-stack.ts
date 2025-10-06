import { Duration, RemovalPolicy, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc, SubnetType, SecurityGroup, Peer, Port, InterfaceVpcEndpointAwsService, InstanceType } from 'aws-cdk-lib/aws-ec2';
import { Cluster, ContainerImage, FargateService, FargateTaskDefinition, LogDrivers, Protocol, Secret as EcsSecret } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, ListenerAction, ListenerCondition } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { ApplicationListenerCertificate } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { DatabaseInstance, DatabaseInstanceEngine, PostgresEngineVersion, Credentials, StorageType } from 'aws-cdk-lib/aws-rds';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { EnvConfig } from './config';

export interface ServiceStackProps extends StackProps {
  readonly config: EnvConfig;
}

export class ServiceStack extends Stack {
  public readonly vpc: Vpc;
  public readonly loadBalancer: ApplicationLoadBalancer;
  public readonly serviceSecurityGroup: SecurityGroup;

  public constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.vpc = new Vpc(this, 'Vpc', {
      maxAzs: config.network.maxAzs,
      natGateways: 1,
      ipAddresses: { cidr: config.network.cidr },
      subnetConfiguration: [
        { name: 'Public', subnetType: SubnetType.PUBLIC },
        { name: 'PrivateApp', subnetType: SubnetType.PRIVATE_WITH_EGRESS },
        { name: 'PrivateData', subnetType: SubnetType.PRIVATE_ISOLATED }
      ]
    });

    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER
    });

    this.vpc.addInterfaceEndpoint('KmsEndpoint', {
      service: InterfaceVpcEndpointAwsService.KMS
    });

    const albSecurityGroup = new SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      allowAllOutbound: true,
      description: 'Allow HTTPS from trusted CIDR ranges'
    });
    config.network.allowedIngressCidrs.forEach((cidr, index) => {
      albSecurityGroup.addIngressRule(Peer.ipv4(cidr), Port.tcp(443), `Trusted ingress ${index}`);
    });

    const serviceSecurityGroup = new SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc: this.vpc,
      allowAllOutbound: true,
      description: 'Allow ingress from ALB only'
    });
    serviceSecurityGroup.addIngressRule(albSecurityGroup, Port.tcp(config.service.containerPort), 'Ingress from ALB');
    this.serviceSecurityGroup = serviceSecurityGroup;

    const databaseSecurityGroup = new SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      allowAllOutbound: false,
      description: 'Restrict database access to ECS tasks'
    });
    databaseSecurityGroup.addIngressRule(serviceSecurityGroup, Port.tcp(5432), 'Postgres from service tasks');

    const dbCredentialsSecret = new Secret(this, 'DatabaseCredentialsSecret', {
      secretName: `apgms/${config.name}/database`,
      description: 'App database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: config.database.username }),
        generateStringKey: 'password',
        excludePunctuation: true
      }
    });

    const mtlsSecret = Secret.fromSecretNameV2(this, 'MtlsSecret', config.tlsSecret.secretName);

    const database = new DatabaseInstance(this, 'Postgres', {
      vpc: this.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      credentials: Credentials.fromSecret(dbCredentialsSecret),
      engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.of(config.database.engineVersion) }),
      instanceType: new InstanceType(config.database.instanceClass),
      allocatedStorage: config.database.allocatedStorage,
      storageType: StorageType.GP3,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      backupRetention: Duration.days(7),
      cloudwatchLogsExports: ['postgresql'],
      copyTagsToSnapshot: true,
      multiAz: false
    });

    Tags.of(database).add('DataClassification', 'Confidential');

    const cluster = new Cluster(this, 'Cluster', {
      vpc: this.vpc,
      containerInsights: true
    });

    const taskDefinition = new FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: config.service.cpu,
      memoryLimitMiB: config.service.memoryLimitMiB
    });

    const containerLogGroup = new LogGroup(this, 'AppLogGroup', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const repository = Repository.fromRepositoryName(this, 'ServiceRepository', config.service.image.repositoryName);

    const container = taskDefinition.addContainer('AppContainer', {
      image: ContainerImage.fromEcrRepository(repository, config.service.image.tag),
      logging: LogDrivers.awsLogs({ streamPrefix: 'app', logGroup: containerLogGroup }),
      secrets: {
        DATABASE_HOST: EcsSecret.fromSecretsManager(database.secret!, 'host'),
        DATABASE_PORT: EcsSecret.fromSecretsManager(database.secret!, 'port'),
        DATABASE_NAME: EcsSecret.fromSecretsManager(database.secret!, 'dbname'),
        DATABASE_USER: EcsSecret.fromSecretsManager(database.secret!, 'username'),
        DATABASE_PASSWORD: EcsSecret.fromSecretsManager(database.secret!, 'password'),
        MTLS_CLIENT_CA: EcsSecret.fromSecretsManager(mtlsSecret, config.tlsSecret.clientCaKey),
        MTLS_CERT: EcsSecret.fromSecretsManager(mtlsSecret, config.tlsSecret.certificateKey),
        MTLS_PRIVATE_KEY: EcsSecret.fromSecretsManager(mtlsSecret, config.tlsSecret.privateKeyKey)
      }
    });
    container.addPortMappings({ containerPort: config.service.containerPort, protocol: Protocol.TCP });

    const service = new FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: config.service.desiredCount,
      assignPublicIp: false,
      securityGroups: [serviceSecurityGroup],
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS }
    });

    const loadBalancer = new ApplicationLoadBalancer(this, 'Alb', {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup
    });
    this.loadBalancer = loadBalancer;

    const httpsListener = loadBalancer.addListener('HttpsListener', {
      port: 443,
      protocol: ApplicationProtocol.HTTPS,
      certificates: [ApplicationListenerCertificate.fromArn(config.service.albCertificateArn)],
      defaultAction: ListenerAction.fixedResponse(403, { messageBody: 'Forbidden' })
    });

    const targetGroup = new ApplicationTargetGroup(this, 'ServiceTg', {
      vpc: this.vpc,
      port: config.service.containerPort,
      protocol: ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/healthz',
        healthyHttpCodes: '200-399',
        interval: Duration.seconds(30)
      }
    });

    httpsListener.addAction('AllowMutualTlsTraffic', {
      priority: 1,
      action: ListenerAction.forward([targetGroup]),
      conditions: [ListenerCondition.httpHeader('x-mtls-authenticated', ['true'])]
    });
  }
}
