import { parse } from "csv-parse/sync";
/** Split-payment settlement ingestion (stub). CSV cols: txn_id,gst_cents,net_cents,settlement_ts */
export function parseSettlementCSV(csvText: string) {
  const rows = parse(csvText, { columns: true, skip_empty_lines: true });
  return rows.map((r:any) => ({
    txn_id: String(r.txn_id),
    gst_cents: Number(r.gst_cents),
    net_cents: Number(r.net_cents),
    settlement_ts: new Date(r.settlement_ts).toISOString()
  }));
}
