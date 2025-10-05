import fs from 'node:fs';
import https from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import axios from 'axios';

function readOptional(file) {
  if (!file) return undefined;
  try {
    return fs.readFileSync(file);
  } catch (err) {
    console.warn(`[bank-real] Unable to read ${file}:`, err);
    return undefined;
  }
}

function requireFeatureFlag(flagName) {
  const enabled = process.env[flagName];
  if (!enabled || !['1', 'true', 'yes'].includes(enabled.toLowerCase())) {
    throw new Error(`Real bank provider disabled. Enable by setting ${flagName}=true`);
  }
}

export class RealBankEgress {
  constructor() {
    this.baseURL = process.env.BANK_API_BASE;
    if (!this.baseURL) {
      console.warn('[bank-real] BANK_API_BASE not configured; requests will fail');
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: Number(process.env.BANK_TIMEOUT_MS || '8000'),
      httpsAgent: new https.Agent({
        ca: readOptional(process.env.BANK_TLS_CA),
        cert: readOptional(process.env.BANK_TLS_CERT),
        key: readOptional(process.env.BANK_TLS_KEY),
        rejectUnauthorized: true,
      }),
    });
  }

  async payout(rpt, amount_cents, ref) {
    requireFeatureFlag('BANK_REAL_ENABLED');

    const transferUuid = randomUUID();
    const payload = {
      amount_cents,
      meta: {
        rpt_id: rpt?.rpt_id,
        abn: ref?.abn,
        taxType: ref?.taxType,
        periodId: ref?.periodId,
        transferUuid,
      },
      destination: ref?.destination ?? {},
    };

    const idempotencyKey = ref?.idempotencyKey || randomUUID();

    const response = await this.client.post('/payments/eft-bpay', payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });

    const receipt = response.data?.receipt_id ?? randomUUID();
    const hash = createHash('sha256').update(String(receipt)).digest('hex');

    return {
      transferUuid,
      bankReceiptHash: hash,
      providerReceiptId: receipt,
      rawResponse: response.data,
    };
  }
}
