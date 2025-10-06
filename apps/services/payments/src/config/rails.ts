import '../loadEnv.js';

export type RailChannel = 'BPAY' | 'EFT';

function parseBool(v: string | undefined): boolean {
  return v === '1' || v === 'true' || v === 'TRUE';
}

function parseList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

const FEATURE_RAILS_REAL = parseBool(process.env.FEATURE_RAILS_REAL);
const RAIL_CHANNEL = (process.env.RAIL_CHANNEL?.toUpperCase() as RailChannel | undefined) ?? 'BPAY';
const MTLS_CERT_PATH = process.env.MTLS_CERT_PATH ?? '';
const MTLS_KEY_PATH = process.env.MTLS_KEY_PATH ?? '';
const MTLS_CA_PATH = process.env.MTLS_CA_PATH ?? '';
const RAIL_BASE_URL = process.env.RAIL_BASE_URL ?? '';
const RAIL_TIMEOUT_MS = Number(process.env.RAIL_TIMEOUT_MS ?? '10000');

const ALLOWLIST_ABNS = parseList(process.env.ALLOWLIST_ABNS);
const ALLOWLIST_BSB_REGEX = process.env.ALLOWLIST_BSB_REGEX ?? '^\\d{3}-?\\d{3}$';
const ALLOWLIST_CRN_REGEX = process.env.ALLOWLIST_CRN_REGEX ?? '^\\d{8,10}$';

export const RailsConfig = {
  FEATURE_RAILS_REAL,
  RAIL_CHANNEL,
  MTLS_CERT_PATH,
  MTLS_KEY_PATH,
  MTLS_CA_PATH,
  RAIL_BASE_URL,
  RAIL_TIMEOUT_MS,
  ALLOWLIST_ABNS,
  ALLOWLIST_BSB_REGEX,
  ALLOWLIST_CRN_REGEX,
} as const;

export type RailsConfigType = typeof RailsConfig;
