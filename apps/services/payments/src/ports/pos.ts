export interface PosPort {
  ingestSale(event: {
    abn: string;
    grossCents: number;
    gstCents: number;
    occurredAt: string;
  }): Promise<void>;
}
