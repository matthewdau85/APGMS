export interface PayrollPort {
  ingest(evt: any): Promise<void>;
}
