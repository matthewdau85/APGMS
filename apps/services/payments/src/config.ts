import './loadEnv.js';

type Mode = 'LIVE' | 'DRY_RUN' | 'SHADOW_ONLY';

const bool = (value: string | undefined): boolean => value === 'true' || value === '1';

export const FEATURE_MTLS = bool(process.env.FEATURE_MTLS);
export const DRY_RUN_MODE = bool(process.env.DRY_RUN);
export const SHADOW_ONLY_MODE = bool(process.env.SHADOW_ONLY);

if (DRY_RUN_MODE && SHADOW_ONLY_MODE) {
  throw new Error('DRY_RUN and SHADOW_ONLY modes are mutually exclusive.');
}

export const BANK_MODE: Mode = DRY_RUN_MODE
  ? 'DRY_RUN'
  : SHADOW_ONLY_MODE
  ? 'SHADOW_ONLY'
  : 'LIVE';

const allowlistRaw = process.env.BANK_ABN_ALLOWLIST || '';
export const ABN_ALLOWLIST = new Set(
  allowlistRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
);

export const BANK_API_BASE = process.env.BANK_API_BASE || 'http://localhost:6100';
export const BANK_TIMEOUT_MS = Number(process.env.BANK_TIMEOUT_MS || '8000');

export const INGEST_HMAC_SECRET = process.env.INGEST_HMAC_SECRET || '';
export const RECON_BASE_URL = process.env.RECON_BASE_URL || 'http://localhost:7100';
export const RECON_TOLERANCE = Number(process.env.RECON_TOLERANCE || '0.01');

export const DEFAULT_BPAY_BILLER = process.env.BPAY_BILLER_CODE || '75556';
