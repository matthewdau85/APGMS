export interface PayrollPort {
  ingestStp(event: {
    abn: string;
    grossCents: number;
    paygCents: number;
    occurredAt: string;
  }): Promise<void>;
}
