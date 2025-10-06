import { randomUUID } from 'crypto';
import { BankingPort, BpayRequest, EftRequest, Receipt } from '../rails/ports.js';

export class MockAdapter implements BankingPort {
  async bpay(request: BpayRequest): Promise<Receipt> {
    const providerRef = `MOCK-BPAY-${randomUUID()}`;
    return {
      providerRef,
      amountCents: request.amountCents,
      channel: 'BPAY',
      meta: { request },
      raw: { provider_ref: providerRef },
      processedAt: new Date(),
    };
  }

  async eft(request: EftRequest): Promise<Receipt> {
    const providerRef = `MOCK-EFT-${randomUUID()}`;
    return {
      providerRef,
      amountCents: request.amountCents,
      channel: 'EFT',
      meta: { request },
      raw: { provider_ref: providerRef },
      processedAt: new Date(),
    };
  }
}
