import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import https from 'https';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

import { BANK_API_BASE, BANK_MODE, BANK_TIMEOUT_MS, FEATURE_MTLS } from '../config.js';
import {
  BpayDestination,
  EftDestination,
  PayToDestination,
  ValidationError,
  assertAbnAllowlisted,
  requireIdempotencyKey,
  validateBpayDestination,
  validateBsbAccount,
} from './validators.js';

export type BankingReceipt = {
  providerReference: string | null;
  raw: any;
  synthetic: boolean;
};

export type BankingRequestBase = {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  idempotencyKey: string;
};

export type EftRequest = BankingRequestBase & { destination: EftDestination };
export type BpayRequest = BankingRequestBase & { destination: BpayDestination };
export type PayToSweepRequest = BankingRequestBase & { destination: PayToDestination };

export interface BankingPort {
  eft(req: EftRequest): Promise<BankingReceipt>;
  bpay(req: BpayRequest): Promise<BankingReceipt>;
  payToSweep(req: PayToSweepRequest): Promise<BankingReceipt>;
}

class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private halfOpen = false;

  constructor(private readonly threshold = 3, private readonly cooldownMs = 30_000) {}

  canRequest() {
    if (this.failures < this.threshold) return true;
    const now = Date.now();
    if (!this.halfOpen && now - this.openedAt > this.cooldownMs) {
      this.halfOpen = true;
      return true;
    }
    return this.halfOpen;
  }

  recordFailure() {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openedAt = Date.now();
    }
    this.halfOpen = false;
  }

  recordSuccess() {
    this.failures = 0;
    this.openedAt = 0;
    this.halfOpen = false;
  }
}

const sleeper = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class BankingAdapter implements BankingPort {
  private readonly client: AxiosInstance;
  private readonly breaker = new CircuitBreaker();

  constructor() {
    const config: AxiosRequestConfig = {
      baseURL: BANK_API_BASE,
      timeout: BANK_TIMEOUT_MS,
      headers: {
        'content-type': 'application/json',
      },
    };

    if (FEATURE_MTLS) {
      const cert = process.env.MTLS_CERT ? readFileSync(process.env.MTLS_CERT) : undefined;
      const key = process.env.MTLS_KEY ? readFileSync(process.env.MTLS_KEY) : undefined;
      const ca = process.env.MTLS_CA ? readFileSync(process.env.MTLS_CA) : undefined;
      config.httpsAgent = new https.Agent({ cert, key, ca, rejectUnauthorized: true });
    }

    this.client = axios.create(config);
  }

  async eft(req: EftRequest): Promise<BankingReceipt> {
    assertAbnAllowlisted(req.abn);
    validateBsbAccount(req.destination);
    return this.dispatch('eft', '/payments/eft-bpay', req, {
      amount_cents: req.amountCents,
      destination: {
        type: 'EFT',
        bsb: req.destination.bsb,
        account: req.destination.account,
      },
    });
  }

  async bpay(req: BpayRequest): Promise<BankingReceipt> {
    assertAbnAllowlisted(req.abn);
    validateBpayDestination(req.destination);
    return this.dispatch('bpay', '/payments/eft-bpay', req, {
      amount_cents: req.amountCents,
      destination: {
        type: 'BPAY',
        biller_code: req.destination.billerCode,
        crn: req.destination.crn,
      },
    });
  }

  async payToSweep(req: PayToSweepRequest): Promise<BankingReceipt> {
    assertAbnAllowlisted(req.abn);
    if (!req.destination.mandateId) {
      throw new ValidationError('MANDATE_REQUIRED');
    }
    return this.dispatch('payto', '/payto/mandates/debit', req, {
      amount_cents: req.amountCents,
      destination: {
        type: 'PAYTO_SWEEP',
        mandate_id: req.destination.mandateId,
      },
    });
  }

  private async dispatch(kind: string, path: string, req: BankingRequestBase, payload: any): Promise<BankingReceipt> {
    requireIdempotencyKey(req.idempotencyKey);

    if (BANK_MODE === 'DRY_RUN') {
      const synthetic = `dryrun:${createHash('sha256')
        .update(req.idempotencyKey)
        .digest('hex')}`;
      return { providerReference: synthetic, raw: { mode: 'DRY_RUN', kind }, synthetic: true };
    }

    if (!this.breaker.canRequest()) {
      throw new Error('BANK_ADAPTER_UNAVAILABLE');
    }

    const headers = { 'Idempotency-Key': req.idempotencyKey };
    const body = {
      ...payload,
      meta: {
        abn: req.abn,
        tax_type: req.taxType,
        period_id: req.periodId,
      },
    };
    const maxAttempts = 4;
    let attempt = 0;
    let lastErr: any;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const resp = await this.client.post(path, body, { headers });
        this.breaker.recordSuccess();
        const providerReference = resp.data?.receipt_id ?? null;
        return { providerReference, raw: resp.data, synthetic: false };
      } catch (err: any) {
        this.breaker.recordFailure();
        lastErr = err;
        if (attempt >= maxAttempts) break;
        const wait = Math.min(4000, 300 * 2 ** (attempt - 1));
        await sleeper(wait);
      }
    }

    throw new Error(
      `Bank transfer failed: ${lastErr?.response?.status ?? ''} ${lastErr?.message ?? lastErr}`.trim()
    );
  }
}

let cachedPort: BankingPort | null = null;
export function getBankingPort(): BankingPort {
  if (!cachedPort) {
    cachedPort = new BankingAdapter();
  }
  return cachedPort;
}
