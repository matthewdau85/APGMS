import fs from 'node:fs';
import { Agent } from 'undici';
import type { IKms } from './IKms';

function getEnv(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (!value && required) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function normaliseBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export class RemoteKmsProvider implements IKms {
  private readonly baseUrl: string;
  private readonly dispatcher: Agent | undefined;
  private readonly defaultKid: string;

  constructor() {
    const endpoint = getEnv('APGMS_RPT_KMS_ENDPOINT', false) || getEnv('KMS_REMOTE_BASE_URL', false) || 'https://kms.apgms.local';
    this.baseUrl = normaliseBaseUrl(endpoint);
    this.defaultKid = process.env.APGMS_RPT_ACTIVE_KID || process.env.RPT_ACTIVE_KID || 'local-dev';

    const disableMtls = (process.env.KMS_REMOTE_DISABLE_MTLS || '').toLowerCase() === 'true';
    if (!disableMtls) {
      const certPath = getEnv('APGMS_RPT_KMS_CLIENT_CERT', false) || process.env.KMS_REMOTE_CLIENT_CERT;
      const keyPath = getEnv('APGMS_RPT_KMS_CLIENT_KEY', false) || process.env.KMS_REMOTE_CLIENT_KEY;
      const caPath = process.env.APGMS_RPT_KMS_CA_CHAIN || process.env.KMS_REMOTE_CA_BUNDLE;

      if (!certPath || !keyPath) {
        throw new Error('KMS mTLS is required but client cert/key were not provided');
      }

      const options: Parameters<typeof Agent>[0] = {
        connect: {
          cert: certPath ? fs.readFileSync(certPath) : undefined,
          key: keyPath ? fs.readFileSync(keyPath) : undefined,
          ca: caPath ? fs.readFileSync(caPath) : undefined,
          rejectUnauthorized: true,
          secureProtocol: 'TLSv1_3_method',
        },
      };

      this.dispatcher = new Agent(options);
    }
  }

  private resolveKid(kid?: string): string {
    return kid || this.defaultKid;
  }

  async verify(payload: Buffer, signature: Buffer, kid?: string): Promise<boolean> {
    const keyId = this.resolveKid(kid);
    if (!keyId) {
      throw new Error('Unable to determine signing key id for verification');
    }

    try {
      const response = await fetch(`${this.baseUrl}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keyId,
          message: payload.toString('base64'),
          signature: signature.toString('base64'),
          algorithm: 'HMAC_SHA256',
        }),
        dispatcher: this.dispatcher,
      });

      if (response.status === 404) {
        return false;
      }

      if (!response.ok) {
        throw new Error(`KMS verification failed with status ${response.status}`);
      }

      const body = (await response.json()) as { valid?: boolean };
      return !!body.valid;
    } catch (err) {
      throw new Error(`Failed to contact KMS: ${String((err as Error).message)}`);
    }
  }
}
