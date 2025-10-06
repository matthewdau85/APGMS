import { Pool } from "pg";
const pool = new Pool();

const parseTags = (raw: unknown): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((tag) => String(tag));
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const withoutBraces = trimmed.startsWith("{") && trimmed.endsWith("}")
      ? trimmed.slice(1, -1)
      : trimmed;
    if (!withoutBraces) return [];
    return withoutBraces
      .split(",")
      .map((part) => part.trim().replace(/^"(.*)"$/, "$1"))
      .filter(Boolean);
  }
  return [];
};

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (await pool.query("select * from periods where abn= and tax_type= and period_id=", [abn, taxType, periodId])).rows[0];
  const rpt = (await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId])).rows[0];
  const deltas = (await pool.query("select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn= and tax_type= and period_id= order by id", [abn, taxType, periodId])).rows;
  const last = deltas[deltas.length - 1];

  let reconRows: any[] = [];
  try {
    const res = await pool.query(
      "select stp_event_id, employee_id, earnings_code, coalesce(w1_cents,0)::bigint as w1_cents, coalesce(w2_cents,0)::bigint as w2_cents, coalesce(special_tags,'{}') as special_tags from recon_inputs where abn=$1 and tax_type=$2 and period_id=$3 order by stp_event_id",
      [abn, taxType, periodId]
    );
    reconRows = res.rows;
  } catch (err: any) {
    if (err?.code !== "42P01") throw err;
  }

  const reconInputs = reconRows.map((row) => {
    const w1 = Number(row.w1_cents ?? 0);
    const w2 = Number(row.w2_cents ?? 0);
    const tags = parseTags(row.special_tags);
    return {
      stp_event_id: row.stp_event_id,
      employee_id: row.employee_id,
      earnings_code: row.earnings_code,
      w1_cents: w1,
      w2_cents: w2,
      special_tags: tags,
    };
  });

  const toEvent = (entry: typeof reconInputs[number], amountKey: "w1_cents" | "w2_cents") => {
    const amount = entry[amountKey];
    if (!amount) return null;
    return {
      stp_event_id: entry.stp_event_id,
      employee_id: entry.employee_id,
      earnings_code: entry.earnings_code,
      amount_cents: amount,
    };
  };

  const w1Events = reconInputs.map((entry) => toEvent(entry, "w1_cents")).filter(Boolean) as Array<{ stp_event_id: string; employee_id: string; earnings_code: string; amount_cents: number }>;
  const w2Events = reconInputs.map((entry) => toEvent(entry, "w2_cents")).filter(Boolean) as Array<{ stp_event_id: string; employee_id: string; earnings_code: string; amount_cents: number }>;

  const basLabels = {
    W1: {
      total_cents: w1Events.reduce((sum, evt) => sum + evt.amount_cents, 0),
      events: w1Events,
      stp_event_ids: w1Events.map((evt) => evt.stp_event_id),
    },
    W2: {
      total_cents: w2Events.reduce((sum, evt) => sum + evt.amount_cents, 0),
      events: w2Events,
      stp_event_ids: w2Events.map((evt) => evt.stp_event_id),
    },
    "1A": null,
    "1B": null,
  } as const;

  const specialEvents: Record<string, Array<{ stp_event_id: string; employee_id: string; earnings_code: string }>> = {};
  reconInputs.forEach((entry) => {
    entry.special_tags.forEach((tag) => {
      if (!specialEvents[tag]) specialEvents[tag] = [];
      specialEvents[tag].push({
        stp_event_id: entry.stp_event_id,
        employee_id: entry.employee_id,
        earnings_code: entry.earnings_code,
      });
    });
  });

  const bundle = {
    bas_labels: basLabels,
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: [],
    stp_recon_inputs: reconInputs,
    special_events: specialEvents,
  };
  return bundle;
}
