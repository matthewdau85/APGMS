import { getSecret } from "./secretManager";

type RequiredEnv = string;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export interface OAuthConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export interface BankApiConfig {
  baseUrl: string;
  oauth: OAuthConfig;
  signingSeed: string;
}

export interface PayrollApiConfig {
  baseUrl: string;
  oauth: OAuthConfig;
}

export interface PosApiConfig {
  baseUrl: string;
  apiKey: string;
  sharedSecret: string;
}

export function getBankApiConfig(): BankApiConfig {
  return {
    baseUrl: requireEnv("BANK_API_BASE_URL"),
    oauth: {
      tokenUrl: requireEnv("BANK_API_TOKEN_URL"),
      clientId: requireEnv("BANK_API_CLIENT_ID"),
      clientSecret: getSecret("BANK_API_CLIENT_SECRET"),
      scope: process.env.BANK_API_SCOPE,
    },
    signingSeed: getSecret("BANK_API_SIGNING_KEY"),
  };
}

export function getPayrollApiConfig(): PayrollApiConfig {
  return {
    baseUrl: requireEnv("PAYROLL_API_BASE_URL"),
    oauth: {
      tokenUrl: requireEnv("PAYROLL_API_TOKEN_URL"),
      clientId: requireEnv("PAYROLL_API_CLIENT_ID"),
      clientSecret: getSecret("PAYROLL_API_CLIENT_SECRET"),
      scope: process.env.PAYROLL_API_SCOPE,
    },
  };
}

export function getPosApiConfig(): PosApiConfig {
  return {
    baseUrl: requireEnv("POS_API_BASE_URL"),
    apiKey: getSecret("POS_API_KEY"),
    sharedSecret: getSecret("POS_API_SHARED_SECRET"),
  };
}

