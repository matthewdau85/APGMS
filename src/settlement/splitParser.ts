import { parse } from "csv-parse/sync";
/**
 * Split-payment settlement ingestion (stub).
 * CSV expected columns: txn_id,gst_cents,net_cents,settlement_ts,bank_reference
 */
export function parseSettlementCSV(csvText: string) {
  const rows = parse(csvText, { columns: true, skip_empty_lines: true });
  return rows.map((r: Record<string, unknown>) => {
    const txnId = r.txn_id ?? r["TXN_ID"] ?? r["transaction_id"];
    const bankRef = r.bank_reference ?? r["bank_ref"] ?? r["reference"] ?? r["BANK_REFERENCE"];
    return {
      txn_id: txnId != null ? String(txnId) : "",
      bank_reference: bankRef != null ? String(bankRef) : "",
      gst_cents: Number(r.gst_cents ?? r["gst"] ?? 0),
      net_cents: Number(r.net_cents ?? r["net"] ?? 0),
      settlement_ts: r.settlement_ts ? new Date(String(r.settlement_ts)).toISOString() : null
    };
  });
}
