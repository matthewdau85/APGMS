import { randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';

export interface StpEmployeePayment {
  employeeId: string;
  taxFileNumber: string;
  gross: number;
  paygWithheld: number;
  superannuation?: number;
  allowances?: number;
  deductions?: number;
}

export interface StpSubmissionRequest {
  organisationName: string;
  abn: string;
  bmsId: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  payrollEvent: 'REGULAR' | 'UPDATE';
  payments: StpEmployeePayment[];
}

export interface StpSubmissionResult {
  success: boolean;
  receiptNumber?: string;
  rawResponse: string;
}

export class StpSubmissionError extends Error {
  constructor(message: string, public readonly responseBody?: string) {
    super(message);
    this.name = 'StpSubmissionError';
  }
}

export class BankApiError extends Error {
  constructor(message: string, public readonly responseBody?: unknown) {
    super(message);
    this.name = 'BankApiError';
  }
}

interface BankPaymentResponse {
  id: string;
  status: string;
  confirmationReference?: string;
}

const SBR2_ENDPOINT = process.env.SBR2_ENDPOINT;
const SBR2_CLIENT_ID = process.env.SBR2_CLIENT_ID;
const SBR2_CLIENT_SECRET = process.env.SBR2_CLIENT_SECRET;
const BANK_API_BASE_URL = process.env.BANK_API_BASE_URL;
const BANK_API_CLIENT_ID = process.env.BANK_API_CLIENT_ID;
const BANK_API_CLIENT_SECRET = process.env.BANK_API_CLIENT_SECRET;
const BANK_SIGNING_SECRET = process.env.BANK_SIGNING_SECRET;
const BANK_POLL_INTERVAL_MS = Number(process.env.BANK_POLL_INTERVAL_MS ?? '2000');
const BANK_POLL_TIMEOUT_MS = Number(process.env.BANK_POLL_TIMEOUT_MS ?? '60000');

function ensureEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return value;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildStpSoapEnvelope(request: StpSubmissionRequest): string {
  const eventId = randomUUID();
  const paymentsXml = request.payments
    .map((payment) => `
        <ns2:PayrollEvent>
          <ns2:EmployeeIdentifier>${escapeXml(payment.employeeId)}</ns2:EmployeeIdentifier>
          <ns2:TaxFileNumber>${escapeXml(payment.taxFileNumber)}</ns2:TaxFileNumber>
          <ns2:GrossAmount>${payment.gross.toFixed(2)}</ns2:GrossAmount>
          <ns2:PAYGWithheld>${payment.paygWithheld.toFixed(2)}</ns2:PAYGWithheld>
          ${payment.superannuation ? `<ns2:Superannuation>${payment.superannuation.toFixed(2)}</ns2:Superannuation>` : ''}
          ${payment.allowances ? `<ns2:Allowances>${payment.allowances.toFixed(2)}</ns2:Allowances>` : ''}
          ${payment.deductions ? `<ns2:Deductions>${payment.deductions.toFixed(2)}</ns2:Deductions>` : ''}
        </ns2:PayrollEvent>
      `)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                    xmlns:ns="http://ato.gov.au/sbr/gov/ato/payload"
                    xmlns:ns2="http://ato.gov.au/sbr/gov/ato/payevnt">
    <soapenv:Header>
      <ns:MessageHeader>
        <ns:MessageID>${eventId}</ns:MessageID>
        <ns:SenderID>${escapeXml(request.bmsId)}</ns:SenderID>
        <ns:ABN>${escapeXml(request.abn)}</ns:ABN>
        <ns:SoftwareInformation>
          <ns:ProductName>APGMS Payroll</ns:ProductName>
          <ns:ProductVersion>1.0</ns:ProductVersion>
        </ns:SoftwareInformation>
      </ns:MessageHeader>
    </soapenv:Header>
    <soapenv:Body>
      <ns2:PAYEVNT>
        <ns2:EmployerDetails>
          <ns2:OrganisationName>${escapeXml(request.organisationName)}</ns2:OrganisationName>
          <ns2:ABN>${escapeXml(request.abn)}</ns2:ABN>
        </ns2:EmployerDetails>
        <ns2:Payroll>
          <ns2:PayrollEventType>${request.payrollEvent}</ns2:PayrollEventType>
          <ns2:PayPeriod>
            <ns2:StartDate>${escapeXml(request.payPeriodStart)}</ns2:StartDate>
            <ns2:EndDate>${escapeXml(request.payPeriodEnd)}</ns2:EndDate>
          </ns2:PayPeriod>
          ${paymentsXml}
        </ns2:Payroll>
      </ns2:PAYEVNT>
    </soapenv:Body>
  </soapenv:Envelope>`;
}

function parseStpReceipt(xml: string): string | undefined {
  const receiptMatch = xml.match(/<SubmissionReceiptNumber>([^<]+)<\/SubmissionReceiptNumber>/);
  if (receiptMatch) {
    return receiptMatch[1];
  }
  const fallbackMatch = xml.match(/<MessageID>([^<]+)<\/MessageID>/);
  return fallbackMatch?.[1];
}

async function httpRequest(
  url: string,
  init: RequestInit,
  expectedStatuses: number[] = [200, 201, 202, 204]
): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!expectedStatuses.includes(response.status)) {
    throw new BankApiError(`Unexpected status ${response.status} from ${url}`, body);
  }
  return { status: response.status, body, headers: response.headers };
}

export async function submitSTPReport(request: StpSubmissionRequest): Promise<StpSubmissionResult> {
  const endpoint = ensureEnv(SBR2_ENDPOINT, 'SBR2_ENDPOINT');
  ensureEnv(SBR2_CLIENT_ID, 'SBR2_CLIENT_ID');
  ensureEnv(SBR2_CLIENT_SECRET, 'SBR2_CLIENT_SECRET');

  const soapEnvelope = buildStpSoapEnvelope(request);

  const { body } = await httpRequest(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml',
      Accept: 'application/xml',
      Authorization: `Basic ${Buffer.from(`${SBR2_CLIENT_ID}:${SBR2_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: soapEnvelope,
  });

  const receipt = parseStpReceipt(body);
  if (!receipt) {
    throw new StpSubmissionError('Unable to locate submission receipt in SBR2 response', body);
  }

  return {
    success: true,
    receiptNumber: receipt,
    rawResponse: body,
  };
}

export async function signTransaction(amount: number, account: string): Promise<string> {
  const secret = ensureEnv(BANK_SIGNING_SECRET, 'BANK_SIGNING_SECRET');
  const secretKey = Buffer.from(secret, 'base64');
  if (secretKey.length !== nacl.sign.secretKeyLength) {
    throw new Error('BANK_SIGNING_SECRET must be a base64 encoded Ed25519 64-byte secret key');
  }
  const payload = Buffer.from(
    JSON.stringify({
      account,
      amount,
      timestamp: new Date().toISOString(),
    })
  );
  const signature = nacl.sign.detached(payload, secretKey);
  return Buffer.from(signature).toString('base64');
}

async function createPaymentInstruction(amount: number, from: string, to: string): Promise<BankPaymentResponse> {
  const baseUrl = ensureEnv(BANK_API_BASE_URL, 'BANK_API_BASE_URL');
  const { body } = await httpRequest(`${baseUrl}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${ensureEnv(BANK_API_CLIENT_ID, 'BANK_API_CLIENT_ID')}:${ensureEnv(BANK_API_CLIENT_SECRET, 'BANK_API_CLIENT_SECRET')}`).toString('base64')}`,
    },
    body: JSON.stringify({
      amount,
      fromAccount: from,
      toAccount: to,
      requiresDualAuthorization: true,
    }),
  });
  return JSON.parse(body) as BankPaymentResponse;
}

async function submitPaymentSignature(paymentId: string, signature: string): Promise<void> {
  const baseUrl = ensureEnv(BANK_API_BASE_URL, 'BANK_API_BASE_URL');
  await httpRequest(`${baseUrl}/payments/${paymentId}/signature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${ensureEnv(BANK_API_CLIENT_ID, 'BANK_API_CLIENT_ID')}:${ensureEnv(BANK_API_CLIENT_SECRET, 'BANK_API_CLIENT_SECRET')}`).toString('base64')}`,
    },
    body: JSON.stringify({ signature }),
  });
}

async function requestDualAuthorization(paymentId: string): Promise<void> {
  const baseUrl = ensureEnv(BANK_API_BASE_URL, 'BANK_API_BASE_URL');
  await httpRequest(`${baseUrl}/payments/${paymentId}/authorisations`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${ensureEnv(BANK_API_CLIENT_ID, 'BANK_API_CLIENT_ID')}:${ensureEnv(BANK_API_CLIENT_SECRET, 'BANK_API_CLIENT_SECRET')}`).toString('base64')}`,
    },
  });
}

async function pollPaymentConfirmation(paymentId: string): Promise<BankPaymentResponse> {
  const baseUrl = ensureEnv(BANK_API_BASE_URL, 'BANK_API_BASE_URL');
  const start = Date.now();
  while (Date.now() - start < BANK_POLL_TIMEOUT_MS) {
    const { body } = await httpRequest(`${baseUrl}/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${ensureEnv(BANK_API_CLIENT_ID, 'BANK_API_CLIENT_ID')}:${ensureEnv(BANK_API_CLIENT_SECRET, 'BANK_API_CLIENT_SECRET')}`).toString('base64')}`,
      },
    });
    const status = JSON.parse(body) as BankPaymentResponse;
    if (status.status === 'CONFIRMED' || status.status === 'SETTLED') {
      return status;
    }
    if (status.status === 'REJECTED') {
      throw new BankApiError(`Payment ${paymentId} rejected`, status);
    }
    await new Promise((resolve) => setTimeout(resolve, BANK_POLL_INTERVAL_MS));
  }
  throw new BankApiError(`Timed out waiting for confirmation of payment ${paymentId}`);
}

export async function transferToOneWayAccount(amount: number, from: string, to: string): Promise<boolean> {
  const payment = await createPaymentInstruction(amount, from, to);
  const signature = await signTransaction(amount, to);
  await submitPaymentSignature(payment.id, signature);
  await requestDualAuthorization(payment.id);
  await pollPaymentConfirmation(payment.id);
  return true;
}

export async function verifyFunds(paygwDue: number, gstDue: number): Promise<boolean> {
  const baseUrl = ensureEnv(BANK_API_BASE_URL, 'BANK_API_BASE_URL');
  const { body } = await httpRequest(`${baseUrl}/funds/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${ensureEnv(BANK_API_CLIENT_ID, 'BANK_API_CLIENT_ID')}:${ensureEnv(BANK_API_CLIENT_SECRET, 'BANK_API_CLIENT_SECRET')}`).toString('base64')}`,
    },
    body: JSON.stringify({
      paygwDue,
      gstDue,
    }),
  });
  const result = JSON.parse(body) as { sufficient: boolean };
  return result.sufficient;
}

export async function initiateTransfer(paygwDue: number, gstDue: number): Promise<boolean> {
  const baseUrl = ensureEnv(BANK_API_BASE_URL, 'BANK_API_BASE_URL');
  const { body } = await httpRequest(`${baseUrl}/funds/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${ensureEnv(BANK_API_CLIENT_ID, 'BANK_API_CLIENT_ID')}:${ensureEnv(BANK_API_CLIENT_SECRET, 'BANK_API_CLIENT_SECRET')}`).toString('base64')}`,
    },
    body: JSON.stringify({
      paygwDue,
      gstDue,
    }),
  });
  const result = JSON.parse(body) as { paymentId?: string; status?: string };
  return Boolean(result.paymentId || result.status === 'QUEUED');
}
