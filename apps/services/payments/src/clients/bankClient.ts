import { AxiosError } from 'axios';
import crypto from 'crypto';
import { getMtlsClient } from './secureHttpClient.js';

export interface VerifyFundsRequest {
  paygwDue: number;
  gstDue: number;
}

export interface VerifyFundsResponse {
  sufficient: boolean;
  availableCents: number;
}

export interface TransferParams {
  amountCents: number;
  debitAccount: string;
  creditAccount: string;
  reference: string;
}

export interface TransferResult {
  bankReceiptHash: string;
  providerTransferId: string;
  status: 'SETTLED' | 'PENDING';
}

function asCents(value: number): number {
  return Math.round(value);
}

export async function verifyFunds(payload: VerifyFundsRequest): Promise<VerifyFundsResponse> {
  const totalCents = asCents((payload.paygwDue + payload.gstDue) * 100);
  const client = getMtlsClient('BANK');
  try {
    const { data } = await client.post('/accounts/verify', {
      totalCents,
      components: [
        { label: 'PAYGW', amountCents: asCents(payload.paygwDue * 100) },
        { label: 'GST', amountCents: asCents(payload.gstDue * 100) },
      ],
    });
    return {
      sufficient: Boolean(data?.sufficient ?? false),
      availableCents: Number(data?.availableCents ?? 0),
    };
  } catch (err) {
    const error = err as AxiosError<{ error?: string; availableCents?: number }>;
    if (error.response?.status === 402) {
      return {
        sufficient: false,
        availableCents: Number(error.response.data?.availableCents ?? 0),
      };
    }
    throw error;
  }
}

export async function transfer(params: TransferParams): Promise<TransferResult> {
  const client = getMtlsClient('BANK');
  const idempotencyKey = crypto.randomUUID();
  const { data, status } = await client.post(
    '/payments/transfer',
    {
      amountCents: asCents(params.amountCents),
      debitAccount: params.debitAccount,
      creditAccount: params.creditAccount,
      reference: params.reference,
    },
    {
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    }
  );

  if (status >= 400) {
    const message = (data as any)?.error || 'Bank transfer failed';
    const err = new Error(message);
    (err as Error & { detail?: unknown }).detail = data;
    throw err;
  }

  return {
    bankReceiptHash: String((data as any)?.bankReceiptHash),
    providerTransferId: String((data as any)?.transferId || (data as any)?.id),
    status: ((data as any)?.status as 'SETTLED' | 'PENDING') ?? 'PENDING',
  };
}
