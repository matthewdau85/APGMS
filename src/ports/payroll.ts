export interface PayrollPort {
  ingest(
    abn: string,
    grossCents: number,
    paygCents: number,
    occurredAtISO: string
  ): Promise<void>;
}
