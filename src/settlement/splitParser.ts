import { parse } from "csv-parse/sync";

type SettlementRow = {
  provider_ref: string;
  amount_cents: number;
  paid_at: string;
  raw: any;
};

export function parseSettlementCSV(csvText: string): SettlementRow[] {
  const rows = parse(csvText, { columns: true, skip_empty_lines: true });
  return rows.map((r: any) => {
    const provider_ref = String(r.provider_ref || r.receipt_id || r.txn_id || r.reference || "").trim();
    const paid = r.paid_at || r.settled_at || r.settlement_ts || r.created_at || new Date().toISOString();
    const amt = Number(r.amount_cents ?? r.amount ?? r.gst_cents ?? 0);
    return {
      provider_ref,
      amount_cents: Number.isFinite(amt) ? amt : 0,
      paid_at: new Date(paid).toISOString(),
      raw: r,
    };
  });
}
