import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { Distribution, SecurityPolicyProtocol, OriginSslPolicy, ViewerProtocolPolicy, ViewerCertificate, SSLMethod } from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { ApplicationLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { EnvConfig } from './config';

export interface EdgeStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly originLoadBalancer: ApplicationLoadBalancer;
}

export class EdgeStack extends Stack {
  public constructor(scope: Stack, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const { config, originLoadBalancer } = props;

    const webAcl = new CfnWebACL(this, 'WebAcl', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: `${config.name}-waf`
      },
      rules: [
        {
          name: 'AWSManagedCommonRuleSet',
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              name: 'AWSManagedRulesCommonRuleSet',
              vendorName: 'AWS'
            }
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            sampledRequestsEnabled: true,
            metricName: `${config.name}-aws-common`
          }
        },
        {
          name: 'RateLimiting',
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: config.cloudFront.wafIpRateLimit,
              aggregateKeyType: 'IP'
            }
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            sampledRequestsEnabled: true,
            metricName: `${config.name}-rate`
          }
        }
      ]
    });

    const certificate = Certificate.fromCertificateArn(this, 'CloudFrontCertificate', config.cloudFront.certificateArn);

    const distribution = new Distribution(this, 'Distribution', {
      domainNames: [config.cloudFront.domainName],
      certificate: ViewerCertificate.fromAcmCertificate(certificate, {
        securityPolicy: SecurityPolicyProtocol.TLS_V1_2_2021,
        sslMethod: SSLMethod.SNI
      }),
      defaultBehavior: {
        origin: new LoadBalancerV2Origin(originLoadBalancer, {
          protocolPolicy: OriginSslPolicy.TLS_V1_2,
          httpPort: 80,
          httpsPort: 443,
          readTimeout: Duration.seconds(30),
          keepaliveTimeout: Duration.seconds(5),
          originSslProtocols: [OriginSslPolicy.TLS_V1_2],
          customHeaders: {
            'x-mtls-authenticated': 'true'
          }
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: {
          cachedMethods: ['GET', 'HEAD'],
          items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE']
        }
      },
      enableLogging: true
    });

    new CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: distribution.distributionArn,
      webAclArn: webAcl.attrArn
    });

    new CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.domainName}`,
      description: 'CloudFront endpoint'
    });
  }
}
