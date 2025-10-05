import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import https from 'https';
import path from 'path';

export type ClientKind = 'BANK' | 'STP';

interface MtlsConfig {
  baseUrl: string;
  certPath: string;
  keyPath: string;
  caPath?: string;
}

const clientCache: Partial<Record<ClientKind, AxiosInstance>> = {};

function resolveFile(filePath: string): string {
  if (!filePath) {
    throw new Error('mTLS configuration is missing file path');
  }
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`mTLS material not found at ${resolved}`);
  }
  return resolved;
}

function buildConfig(kind: ClientKind): MtlsConfig {
  const prefix = kind === 'BANK' ? 'BANK' : 'STP';
  const baseUrl = process.env[`${prefix}_API_BASE_URL`];
  const certPath = process.env[`${prefix}_CLIENT_CERT_PATH`];
  const keyPath = process.env[`${prefix}_CLIENT_KEY_PATH`];
  const caPath = process.env[`${prefix}_CA_CERT_PATH`];

  if (!baseUrl || !certPath || !keyPath) {
    throw new Error(`${prefix} API mTLS configuration incomplete`);
  }

  return {
    baseUrl,
    certPath: resolveFile(certPath),
    keyPath: resolveFile(keyPath),
    caPath: caPath ? resolveFile(caPath) : undefined,
  };
}

function createClient(kind: ClientKind): AxiosInstance {
  const { baseUrl, certPath, keyPath, caPath } = buildConfig(kind);
  const agent = new https.Agent({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    ca: caPath ? fs.readFileSync(caPath) : undefined,
    rejectUnauthorized: process.env.NODE_ENV !== 'development',
  });

  return axios.create({
    baseURL: baseUrl.replace(/\/$/, ''),
    httpsAgent: agent,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
    },
    validateStatus: (status) => status < 500,
  });
}

export function getMtlsClient(kind: ClientKind): AxiosInstance {
  if (!clientCache[kind]) {
    clientCache[kind] = createClient(kind);
  }
  return clientCache[kind] as AxiosInstance;
}
