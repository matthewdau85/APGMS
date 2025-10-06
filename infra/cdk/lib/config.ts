import { Environment } from 'aws-cdk-lib';

export interface NetworkConfig {
  readonly maxAzs: number;
  readonly cidr: string;
  readonly allowedIngressCidrs: string[];
}

export interface DatabaseConfig {
  readonly username: string;
  readonly instanceClass: string;
  readonly allocatedStorage: number;
  readonly engineVersion: string;
}

export interface PipelineConfig {
  readonly connectionArn: string;
  readonly repository: string;
  readonly branch: string;
}

export interface CloudFrontConfig {
  readonly domainName: string;
  readonly certificateArn: string;
  readonly wafIpRateLimit: number;
}

export interface ServiceImageConfig {
  readonly repositoryName: string;
  readonly tag: string;
}

export interface ServiceConfig {
  readonly cpu: number;
  readonly memoryLimitMiB: number;
  readonly containerPort: number;
  readonly desiredCount: number;
  readonly image: ServiceImageConfig;
  readonly albCertificateArn: string;
}

export interface TlsSecretConfig {
  /**
   * Secrets Manager name for the mutual TLS bundle that includes
   * the client CA, certificate, and private key (PEM-encoded).
   */
  readonly secretName: string;
  /**
   * JSON keys used inside the secret to store PEM payloads.
   */
  readonly clientCaKey: string;
  readonly certificateKey: string;
  readonly privateKeyKey: string;
}

export interface EnvConfig {
  readonly name: string;
  readonly env: Environment;
  readonly network: NetworkConfig;
  readonly database: DatabaseConfig;
  readonly cloudFront: CloudFrontConfig;
  readonly service: ServiceConfig;
  readonly pipeline?: PipelineConfig;
  readonly tlsSecret: TlsSecretConfig;
}

const defaults: Record<string, EnvConfig> = {
  staging: {
    name: 'staging',
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    network: {
      maxAzs: 2,
      cidr: '10.20.0.0/21',
      allowedIngressCidrs: ['0.0.0.0/0']
    },
    database: {
      username: 'app_service',
      instanceClass: 't4g.medium',
      allocatedStorage: 100,
      engineVersion: '15.4'
    },
    cloudFront: {
      domainName: 'staging.example.com',
      certificateArn: 'arn:aws:acm:us-east-1:111111111111:certificate/example',
      wafIpRateLimit: 2000
    },
    service: {
      cpu: 512,
      memoryLimitMiB: 1024,
      containerPort: 8080,
      desiredCount: 2,
      image: {
        repositoryName: 'apgms/app',
        tag: 'latest'
      },
      albCertificateArn: 'arn:aws:acm:us-west-2:111111111111:certificate/alb-placeholder'
    },
    tlsSecret: {
      secretName: 'apgms/staging/mtls',
      clientCaKey: 'clientCa',
      certificateKey: 'certificate',
      privateKeyKey: 'privateKey'
    }
  }
};

export function resolveEnvConfig(name: string): EnvConfig {
  const cfg = defaults[name];
  if (!cfg) {
    throw new Error(`Environment configuration not found for ${name}`);
  }

  return cfg;
}
