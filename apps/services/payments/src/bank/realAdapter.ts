import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { setTimeout as delay } from 'timers/promises';
import { RailsConfig } from '../config/rails.js';
import { BankingPort, BpayRequest, EftRequest, Receipt } from '../rails/ports.js';
import { HttpError } from '../utils/errors.js';
import { incrementRailRetries, observeRailLatency, setBreakerOpen } from '../utils/metrics.js';

interface CircuitOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

class SimpleCircuitBreaker {
  private failures = 0;
  private nextAttempt = 0;

  constructor(private readonly options: CircuitOptions) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (now < this.nextAttempt) {
      setBreakerOpen(true);
      throw new HttpError(503, 'RAIL_CIRCUIT_OPEN', 'bank rail circuit breaker open');
    }

    try {
      const result = await operation();
      this.failures = 0;
      setBreakerOpen(false);
      return result;
    } catch (err) {
      this.failures += 1;
      if (this.failures >= this.options.failureThreshold) {
        this.nextAttempt = now + this.options.resetTimeoutMs;
        setBreakerOpen(true);
      }
      throw err;
    }
  }
}

function readOptional(path: string): Buffer | undefined {
  if (!path) return undefined;
  return readFileSync(path);
}

export class RealAdapter implements BankingPort {
  private readonly client: AxiosInstance;
  private readonly breaker: SimpleCircuitBreaker;

  constructor() {
    if (!RailsConfig.RAIL_BASE_URL) {
      throw new Error('RAIL_BASE_URL must be configured for RealAdapter');
    }

    const agent = new https.Agent({
      ca: readOptional(RailsConfig.MTLS_CA_PATH),
      cert: readOptional(RailsConfig.MTLS_CERT_PATH),
      key: readOptional(RailsConfig.MTLS_KEY_PATH),
      rejectUnauthorized: true,
    });

    this.client = axios.create({
      baseURL: RailsConfig.RAIL_BASE_URL,
      timeout: RailsConfig.RAIL_TIMEOUT_MS,
      httpsAgent: agent,
    });

    this.breaker = new SimpleCircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30000 });
  }

  async bpay(request: BpayRequest): Promise<Receipt> {
    const payload = {
      amount_cents: request.amountCents,
      biller_code: request.billerCode,
      crn: request.crn,
      metadata: request.meta ?? {},
    };
    return this.execute('bpay', payload, request);
  }

  async eft(request: EftRequest): Promise<Receipt> {
    const payload = {
      amount_cents: request.amountCents,
      bsb: request.bsb,
      account_number: request.accountNumber,
      account_name: request.accountName,
      metadata: request.meta ?? {},
    };
    return this.execute('eft', payload, request);
  }

  private async execute(path: 'bpay' | 'eft', payload: Record<string, unknown>, req: { channel: 'BPAY' | 'EFT'; amountCents: number; idempotencyKey: string; abn: string; periodId: string; taxType: string; }): Promise<Receipt> {
    const headers = {
      'Idempotency-Key': req.idempotencyKey,
      'X-Request-Id': randomUUID(),
    };

    const start = Date.now();
    const attemptPayload = async () => {
      let attempt = 0;
      const maxAttempts = 3;
      let lastError: unknown;
      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          const response = await this.client.post(`/payments/${path}`, payload, { headers });
          const providerRef = String(response.data?.provider_ref ?? response.data?.receipt_id ?? '');
          if (!providerRef) {
            throw new HttpError(502, 'RAIL_PROVIDER_NO_REF', 'provider did not return reference');
          }
          const processedAt = new Date(response.data?.processed_at ?? new Date().toISOString());
          return {
            providerRef,
            amountCents: req.amountCents,
            channel: req.channel,
            meta: {
              request,
              response: response.data,
            },
            raw: response.data,
            processedAt,
          } satisfies Receipt;
        } catch (err: any) {
          lastError = err;
          if (attempt >= maxAttempts) {
            throw err;
          }
          incrementRailRetries(req.channel);
          const backoffMs = 2 ** attempt * 250;
          await delay(backoffMs);
        }
      }
      throw lastError ?? new Error('Unknown rail failure');
    };

    try {
      const receipt = await this.breaker.execute(attemptPayload);
      observeRailLatency(req.channel, Date.now() - start, {
        abn: req.abn,
        periodId: req.periodId,
        taxType: req.taxType,
      });
      console.log(JSON.stringify({
        level: 'info',
        event: 'payments.rail.success',
        request_id: headers['X-Request-Id'],
        abn: req.abn,
        period_id: req.periodId,
        tax_type: req.taxType,
        channel: req.channel,
        provider_ref: receipt.providerRef,
      }));
      return receipt;
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'payments.rail.failure',
        request_id: headers['X-Request-Id'],
        abn: req.abn,
        period_id: req.periodId,
        tax_type: req.taxType,
        channel: req.channel,
        error: err instanceof Error ? err.message : err,
      }));
      throw err;
    }
  }
}
