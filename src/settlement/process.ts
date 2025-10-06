import { parseSettlementCSV } from "./splitParser";

export interface SettlementIngestResult {
  ingested: number;
  rows: Array<{ txn_id: string; gst_cents: number; net_cents: number; settlement_ts: string }>;
}

export function ingestSettlement(csvText: string): SettlementIngestResult {
  if (typeof csvText !== "string" || csvText.trim().length === 0) {
    throw new Error("INVALID_CSV");
  }
  const rows = parseSettlementCSV(csvText);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("NO_ROWS");
  }
  return { ingested: rows.length, rows };
}
