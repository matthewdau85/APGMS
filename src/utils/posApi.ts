export interface PosApiConfig {
  baseUrl: string;
  apiKey: string;
}

export interface PosTaxCode {
  code: string;
  rate: number;
  description: string;
}

export interface PosSaleLine {
  id: string;
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxCode: string;
  taxAmount: number;
}

export interface PosSettlement {
  id: string;
  locationId: string;
  periodStart: string;
  periodEnd: string;
  grossSales: number;
  netSales: number;
  gstCollected: number;
  adjustments: Array<{
    type: 'DISCOUNT' | 'REFUND' | 'MANUAL_ADJUSTMENT';
    reason: string;
    amount: number;
  }>;
  lines: PosSaleLine[];
}

export class PosApiClient {
  constructor(private readonly config: PosApiConfig) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`POS API ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  async fetchTaxCodes(): Promise<PosTaxCode[]> {
    return this.request<PosTaxCode[]>('/metadata/tax-codes');
  }

  async fetchSettlement(periodStart: string, periodEnd: string, locationId?: string): Promise<PosSettlement> {
    const params = new URLSearchParams({ periodStart, periodEnd });
    if (locationId) {
      params.append('locationId', locationId);
    }
    return this.request<PosSettlement>(`/settlements?${params.toString()}`);
  }
}

export function createPosClient(): PosApiClient {
  const baseUrl = process.env.POS_API_BASE_URL;
  const apiKey = process.env.POS_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('POS_API_BASE_URL and POS_API_KEY must be configured');
  }

  return new PosApiClient({ baseUrl, apiKey });
}
