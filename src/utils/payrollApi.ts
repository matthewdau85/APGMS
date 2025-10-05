import { randomUUID } from 'node:crypto';

export interface PayrollApiConfig {
  baseUrl: string;
  apiKey: string;
}

export interface PayrollEmployee {
  id: string;
  externalId?: string;
  fullName: string;
  taxFileNumber: string;
}

export interface PayrollEarningsType {
  code: string;
  description: string;
  category: string;
  taxTreatment: 'TAXABLE' | 'ALLOWANCE' | 'DEDUCTED';
}

export interface PayrollAdjustment {
  type: 'DEDUCTION' | 'ALLOWANCE' | 'SUPER';
  code: string;
  description: string;
  amount: number;
}

export interface PayrollLineItem {
  employeeId: string;
  earningsType: string;
  amount: number;
  paygWithheld: number;
  adjustments: PayrollAdjustment[];
}

export interface PayrollRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  lines: PayrollLineItem[];
}

export class PayrollApiClient {
  constructor(private readonly config: PayrollApiConfig) {}

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
      throw new Error(`Payroll API ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  async fetchEmployees(): Promise<PayrollEmployee[]> {
    return this.request<PayrollEmployee[]>('/employees');
  }

  async fetchEarningsTypes(): Promise<PayrollEarningsType[]> {
    return this.request<PayrollEarningsType[]>('/metadata/earnings-types');
  }

  async fetchAdjustments(): Promise<PayrollAdjustment[]> {
    return this.request<PayrollAdjustment[]>('/metadata/adjustments');
  }

  async fetchPayRun(periodStart: string, periodEnd: string): Promise<PayrollRun> {
    const id = randomUUID();
    const lines = await this.request<PayrollLineItem[]>(
      `/payruns?periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`
    );

    return {
      id,
      periodStart,
      periodEnd,
      lines,
    };
  }
}

export function createPayrollClient(): PayrollApiClient {
  const baseUrl = process.env.PAYROLL_API_BASE_URL;
  const apiKey = process.env.PAYROLL_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('PAYROLL_API_BASE_URL and PAYROLL_API_KEY must be configured');
  }

  return new PayrollApiClient({ baseUrl, apiKey });
}
