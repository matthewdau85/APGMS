import { Request, Response } from 'express';
import { payAtoRelease } from '../src/routes/payAto.js';

jest.mock('../src/clients/stpClient.js', () => ({
  submitReport: jest.fn(),
}));

jest.mock('../src/clients/bankClient.js', () => ({
  transfer: jest.fn(),
}));

const submitReport = require('../src/clients/stpClient.js').submitReport as jest.Mock;
const bankTransfer = require('../src/clients/bankClient.js').transfer as jest.Mock;

function buildReq(body: any): Request {
  const req = {
    body,
  } as Partial<Request> as Request;
  (req as any).rpt = { rpt_id: 'rpt', kid: 'kid', payload_sha256: 'hash' };
  return req;
}

function buildRes() {
  const res: Partial<Response & { body?: any; statusCode: number }> = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this as any;
    },
    json(payload: any) {
      this.body = payload;
      return this as any;
    },
  };
  return res as Response & { body?: any; statusCode: number };
}

describe('payAtoRelease failure handling', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('bubbles STP rejection with 422 status', async () => {
    submitReport.mockRejectedValue(new Error('ATO rejected payload'));

    const req = buildReq({
      abn: '123',
      taxType: 'PAYGW',
      periodId: '2025-09',
      amountCents: -100,
      stp: { paygwCents: 5000, gstCents: 2000, period: '2025-09' },
      bank: { debitAccount: '111', creditAccount: '222', reference: 'ATO' },
    });
    const res = buildRes();

    await payAtoRelease(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ error: 'STP_REJECTED' });
    expect(submitReport).toHaveBeenCalledTimes(1);
    expect(bankTransfer).not.toHaveBeenCalled();
  });

  it('returns 402 when bank transfer fails', async () => {
    submitReport.mockResolvedValue({ confirmationId: 'stp-1', acceptedAt: new Date().toISOString() });
    bankTransfer.mockRejectedValue(new Error('Insufficient funds'));

    const req = buildReq({
      abn: '123',
      taxType: 'PAYGW',
      periodId: '2025-09',
      amountCents: -100,
      stp: { paygwCents: 5000, gstCents: 2000, period: '2025-09' },
      bank: { debitAccount: '111', creditAccount: '222', reference: 'ATO' },
    });
    const res = buildRes();

    await payAtoRelease(req, res);

    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ error: 'BANK_TRANSFER_FAILED' });
    expect(submitReport).toHaveBeenCalledTimes(1);
    expect(bankTransfer).toHaveBeenCalledTimes(1);
  });
});
