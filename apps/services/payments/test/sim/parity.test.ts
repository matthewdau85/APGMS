import type { MockedFunction } from 'jest-mock';
import { runParitySimulation } from '../../src/sim/parity.js';

type AxiosPost = MockedFunction<(
  url: string,
  payload: any,
  options?: { headers?: Record<string, string> }
) => Promise<{ data: { receipt_id: string } }>>;

const receiptByKey = new Map<string, string>();
let counter = 0;

const nextSequence = () => (++counter).toString(16).padStart(6, '0');

jest.mock('axios', () => {
  return {
    create: () => ({
      post: ((url: string, _payload: any, options?: { headers?: Record<string, string> }) => {
        const provided = options?.headers?.['Idempotency-Key'];
        const key = provided ?? `missing-${nextSequence()}`;
        if (!receiptByKey.has(key)) {
          const receipt = `${url.replace(/[^a-z]/gi, '').slice(-8)}-${nextSequence()}`;
          receiptByKey.set(key, receipt);
        }
        const receipt_id = receiptByKey.get(key)!;
        return Promise.resolve({ data: { receipt_id } });
      }) as AxiosPost,
    }),
  };
});

describe('prototype parity simulation', () => {
  beforeEach(() => {
    receiptByKey.clear();
    counter = 0;
  });

  test('sim release → recon import → evidence stays consistent', async () => {
    const config = {
      abn: '12345678901',
      taxType: 'PAYGW',
      periodId: '2025-09',
      amount_cents: 12500,
      idempotencyKey: 'idem-key-123',
      destination: { bpay_biller: '75556', crn: '12345678901' },
      gateState: 'RPT-Issued',
      kid: 'kid-prod-001',
    } as const;

    const first = await runParitySimulation(config);
    const second = await runParitySimulation(config);

    expect(first.recon.provider_ref).toBeTruthy();
    expect(first.recon.provider_ref).toEqual(second.recon.provider_ref);

    expect(first.evidence.settlement.amount_cents).toBe(config.amount_cents);
    expect(first.evidence.settlement.provider_ref).toEqual(first.recon.provider_ref);

    expect(first.evidence.rules.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);

    expect(first.evidence.narrative.some(line => line.includes(config.gateState))).toBe(true);
    expect(first.evidence.narrative.some(line => line.includes(config.kid))).toBe(true);
  });
});
