import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import nacl from 'tweetnacl';

const keyPair = nacl.sign.keyPair();
process.env.BANK_SIGNING_SECRET = Buffer.from(keyPair.secretKey).toString('base64');
process.env.SBR2_CLIENT_ID = 'test-client';
process.env.SBR2_CLIENT_SECRET = 'test-secret';
process.env.BANK_API_CLIENT_ID = 'bank-client';
process.env.BANK_API_CLIENT_SECRET = 'bank-secret';

let submissionCount = 0;
let paymentStatus = 'PENDING_SIGNATURE';
let statusPolls = 0;

const server = createServer(async (req, res) => {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Uint8Array);
  }
  const body = Buffer.concat(chunks).toString();

  if (url === '/sbr2' && method === 'POST') {
    submissionCount += 1;
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end(`<?xml version="1.0"?><Response><SubmissionReceiptNumber>SRN-${submissionCount}</SubmissionReceiptNumber></Response>`);
    return;
  }

  if (url === '/funds/verify' && method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sufficient: true }));
    return;
  }

  if (url === '/funds/initiate' && method === 'POST') {
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ paymentId: 'payment-123', status: 'QUEUED' }));
    return;
  }

  if (url === '/payments' && method === 'POST') {
    paymentStatus = 'PENDING_SIGNATURE';
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'payment-123', status: paymentStatus }));
    return;
  }

  if (url === '/payments/payment-123/signature' && method === 'POST') {
    paymentStatus = 'AWAITING_DUAL_AUTH';
    res.writeHead(204).end();
    return;
  }

  if (url === '/payments/payment-123/authorisations' && method === 'POST') {
    paymentStatus = 'AWAITING_CONFIRMATION';
    res.writeHead(202).end();
    return;
  }

  if (url === '/payments/payment-123' && method === 'GET') {
    statusPolls += 1;
    if (statusPolls > 1) {
      paymentStatus = 'CONFIRMED';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'payment-123', status: paymentStatus, confirmationReference: 'CONF-001' }));
    return;
  }

  res.writeHead(404).end();
});

let bankApi: typeof import('../../src/utils/bankApi');

before(async () => {
  server.listen(0);
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  process.env.SBR2_ENDPOINT = `${baseUrl}/sbr2`;
  process.env.BANK_API_BASE_URL = baseUrl;

  bankApi = await import('../../src/utils/bankApi');
});

after(async () => {
  server.close();
  await once(server, 'close');
});

describe('STP and bank integrations', () => {
  it('submits STP reports and returns a receipt', async () => {
    const result = await bankApi.submitSTPReport({
      organisationName: 'ACME Pty Ltd',
      abn: '53004085616',
      bmsId: 'APGMS-BMS-01',
      payPeriodStart: '2024-07-01',
      payPeriodEnd: '2024-07-07',
      payrollEvent: 'REGULAR',
      payments: [
        {
          employeeId: 'E001',
          taxFileNumber: '123456789',
          gross: 2500,
          paygWithheld: 500,
        },
      ],
    });

    assert.equal(result.success, true);
    assert.match(result.receiptNumber ?? '', /^SRN-/);
  });

  it('performs dual-authorised transfers to one-way accounts', async () => {
    statusPolls = 0;
    const completed = await bankApi.transferToOneWayAccount(1500, 'business', 'one-way');
    assert.equal(completed, true);
  });

  it('verifies funds and initiates release', async () => {
    const fundsOk = await bankApi.verifyFunds(1200, 400);
    assert.equal(fundsOk, true);

    const initiated = await bankApi.initiateTransfer(1200, 400);
    assert.equal(initiated, true);
  });
});
