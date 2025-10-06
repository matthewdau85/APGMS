export interface PosPort {
  ingest(evt: any): Promise<void>;
}
