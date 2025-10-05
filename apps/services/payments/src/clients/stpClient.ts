import crypto from 'crypto';
import { AxiosInstance } from 'axios';
import { getMtlsClient } from './secureHttpClient.js';

export interface SubmitReportRequest {
  paygwCents: number;
  gstCents: number;
  period: string;
}

export interface SubmitReportResponse {
  confirmationId: string;
  acceptedAt: string;
}

function stpClient(): AxiosInstance {
  return getMtlsClient('STP');
}

export async function submitReport(payload: SubmitReportRequest): Promise<SubmitReportResponse> {
  const client = stpClient();
  const { data, status } = await client.post(
    '/reports',
    {
      paygwCents: Math.round(payload.paygwCents),
      gstCents: Math.round(payload.gstCents),
      period: payload.period,
      messageId: crypto.randomUUID(),
    },
    {
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
      },
    }
  );

  if (status >= 400) {
    const message = (data as any)?.error || 'STP report rejected';
    const err = new Error(message);
    (err as Error & { detail?: unknown }).detail = data;
    throw err;
  }

  return {
    confirmationId: String((data as any)?.confirmationId || (data as any)?.id),
    acceptedAt: (data as any)?.acceptedAt || new Date().toISOString(),
  };
}
