import { Pool, PoolClient } from "pg";
import { sha256Hex } from "../crypto/merkle.js";

type BasLabels = { W1: number | null; W2: number | null; "1A": number | null; "1B": number | null };
type BasSummary = { w1: number; w2: number; a1: number; b1: number };
type DiscrepancyEntry = {
  type: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  trace_id: string;
  [key: string]: unknown;
};

type LedgerSnapshot = {
  credited_cents: number;
  net_cents: number;
};

type PoolLike = { connect: () => Promise<PoolClient> };

let pool: PoolLike = new Pool();

export function setEvidencePool(mock: PoolLike) {
  pool = mock;
}

function coerceNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (value instanceof Date) return value.getTime();
  return Number(value ?? 0);
}

function asIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return value;
  }
  return null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function sortedJsonString(entry: Record<string, unknown>): string {
  const keys = Object.keys(entry).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of keys) sorted[key] = entry[key];
  return JSON.stringify(sorted);
}

async function regclassExists(client: PoolClient, qualified: string): Promise<boolean> {
  const { rows } = await client.query<{ reg: string | null }>(
    "SELECT to_regclass($1) AS reg",
    [qualified]
  );
  return Boolean(rows[0]?.reg);
}

async function getColumns(client: PoolClient, tableName: string): Promise<Set<string>> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  );
  return new Set(rows.map(r => r.column_name));
}

function pickColumn(columns: Set<string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (columns.has(candidate)) return candidate;
  }
  return null;
}

async function loadBasSummary(
  client: PoolClient,
  abn: string,
  taxType: string,
  periodId: string
): Promise<BasSummary | null> {
  const tableName = "period_tax_summaries";
  if (!(await regclassExists(client, `public.${tableName}`))) return null;

  const columns = await getColumns(client, tableName);
  const w1Col = pickColumn(columns, ["w1_cents", "paygw_gross_cents", "gross_wages_cents"]);
  const w2Col = pickColumn(columns, ["w2_cents", "paygw_withheld_cents", "withheld_cents"]);
  const a1Col = pickColumn(columns, ["gst_on_sales_cents", "gst_collected_cents", "label_1a_cents"]);
  const b1Col = pickColumn(columns, ["gst_on_purchases_cents", "gst_credits_cents", "label_1b_cents", "gst_input_tax_credits_cents"]);
  if (!w1Col || !w2Col || !a1Col || !b1Col) return null;

  const hasTaxType = columns.has("tax_type");
  const hasComputedAt = columns.has("computed_at");
  const tableIdent = `public."${tableName}"`;
  const selectSql = [
    `SELECT "${w1Col}" AS w1, "${w2Col}" AS w2, "${a1Col}" AS a1, "${b1Col}" AS b1`,
    `FROM ${tableIdent}`,
    `WHERE abn=$1 AND period_id=$2${hasTaxType ? " AND tax_type=$3" : ""}`,
    hasComputedAt ? "ORDER BY computed_at DESC" : "",
    "LIMIT 1"
  ]
    .filter(Boolean)
    .join(" ");

  const params: string[] = [abn, periodId];
  if (hasTaxType) params.push(taxType);
  const { rows } = await client.query(selectSql, params);
  if (!rows[0]) return null;
  return {
    w1: coerceNumber(rows[0].w1),
    w2: coerceNumber(rows[0].w2),
    a1: coerceNumber(rows[0].a1),
    b1: coerceNumber(rows[0].b1)
  };
}

function addDiscrepancy(log: DiscrepancyEntry[], entry: Omit<DiscrepancyEntry, "trace_id">) {
  const payload = sortedJsonString(entry as Record<string, unknown>);
  log.push({ ...entry, trace_id: sha256Hex(payload) });
}

async function loadReconciledTotals(
  client: PoolClient,
  abn: string,
  taxType: string,
  periodId: string,
  ledgerFallback: LedgerSnapshot
): Promise<LedgerSnapshot> {
  if (await regclassExists(client, "public.v_period_balances")) {
    const { rows } = await client.query<LedgerSnapshot>(
      `SELECT COALESCE(credited_cents,0) AS credited_cents, COALESCE(net_cents,0) AS net_cents
       FROM v_period_balances
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    if (rows[0]) {
      return {
        credited_cents: coerceNumber(rows[0].credited_cents),
        net_cents: coerceNumber(rows[0].net_cents)
      };
    }
  }
  return ledgerFallback;
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const client = await pool.connect();
  try {
    const periodRes = await client.query(
      `SELECT state, accrued_cents, credited_to_owa_cents, final_liability_cents,
              merkle_root, running_balance_hash, anomaly_vector, thresholds
         FROM periods
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    if (periodRes.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
    const periodRow = periodRes.rows[0];

    const anomalyVector = parseJson<Record<string, number>>(periodRow.anomaly_vector, {});
    const thresholds = parseJson<Record<string, number>>(periodRow.thresholds, {});

    const rptRes = await client.query(
      `SELECT payload, payload_c14n, payload_sha256, signature, created_at
         FROM rpt_tokens
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY created_at DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    );
    const rptRow = rptRes.rows[0] ?? null;

    const ledgerRes = await client.query(
      `SELECT id, transfer_uuid, amount_cents, balance_after_cents,
              bank_receipt_hash, prev_hash, hash_after, created_at
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id`,
      [abn, taxType, periodId]
    );

    let lastReceipt: string | null = null;
    const ledgerEntries = ledgerRes.rows.map(row => {
      if (row.bank_receipt_hash) lastReceipt = row.bank_receipt_hash;
      return {
        id: Number(row.id),
        transfer_uuid: row.transfer_uuid ?? null,
        amount_cents: coerceNumber(row.amount_cents),
        balance_after_cents: coerceNumber(row.balance_after_cents),
        bank_receipt_hash: row.bank_receipt_hash ?? null,
        prev_hash: row.prev_hash ?? null,
        hash_after: row.hash_after ?? null,
        created_at: asIsoString(row.created_at)
      };
    });

    const ledgerSnapshot = ledgerEntries.reduce<LedgerSnapshot & { lastReceipt: string | null }>(
      (acc, entry) => {
        if (entry.amount_cents >= 0) acc.credited_cents += entry.amount_cents;
        acc.net_cents += entry.amount_cents;
        if (entry.bank_receipt_hash) acc.lastReceipt = entry.bank_receipt_hash;
        return acc;
      },
      { credited_cents: 0, net_cents: 0, lastReceipt: lastReceipt }
    );

    const reconciledTotals = await loadReconciledTotals(
      client,
      abn,
      taxType,
      periodId,
      { credited_cents: ledgerSnapshot.credited_cents, net_cents: ledgerSnapshot.net_cents }
    );

    const basSummary = await loadBasSummary(client, abn, taxType, periodId);
    const basLabels: BasLabels = {
      W1: basSummary?.w1 ?? null,
      W2: basSummary?.w2 ?? null,
      "1A": basSummary?.a1 ?? null,
      "1B": basSummary?.b1 ?? null
    };

    const discrepancyLog: DiscrepancyEntry[] = [];

    for (const [metric, value] of Object.entries(anomalyVector)) {
      const actual = Number(value);
      const threshold = thresholds[metric];
      if (threshold !== undefined && Math.abs(actual) > Number(threshold)) {
        addDiscrepancy(discrepancyLog, {
          type: "ANOMALY_THRESHOLD",
          severity: "CRITICAL",
          metric,
          actual,
          threshold: Number(threshold)
        });
      }
    }

    const finalLiability = coerceNumber(periodRow.final_liability_cents ?? 0);
    const ledgerDelta = reconciledTotals.net_cents - finalLiability;
    if (Math.abs(ledgerDelta) > 1) {
      addDiscrepancy(discrepancyLog, {
        type: "LEDGER_FINAL_VARIANCE",
        severity: "WARN",
        expected_cents: finalLiability,
        actual_cents: reconciledTotals.net_cents,
        delta_cents: ledgerDelta
      });
    }

    if (basSummary) {
      const expected = taxType === "PAYGW" ? basSummary.w2 : basSummary.a1;
      const label = taxType === "PAYGW" ? "W2" : "1A";
      const variance = reconciledTotals.credited_cents - expected;
      if (Math.abs(variance) > 1) {
        addDiscrepancy(discrepancyLog, {
          type: "LEDGER_SUMMARY_VARIANCE",
          severity: "WARN",
          label,
          expected_cents: expected,
          actual_cents: reconciledTotals.credited_cents,
          delta_cents: variance
        });
      }
    }

    const rptPayload = rptRow ? parseJson<any>(rptRow.payload, {}) : null;
    const payloadC14n = rptRow?.payload_c14n ?? null;
    const payloadSha = rptRow?.payload_sha256 ?? (payloadC14n ? sha256Hex(payloadC14n) : null);

    return {
      meta: {
        generated_at: new Date().toISOString(),
        abn,
        taxType,
        periodId
      },
      period: {
        state: periodRow.state,
        accrued_cents: coerceNumber(periodRow.accrued_cents ?? 0),
        credited_to_owa_cents: coerceNumber(periodRow.credited_to_owa_cents ?? 0),
        final_liability_cents: finalLiability,
        merkle_root: periodRow.merkle_root ?? null,
        running_balance_hash: periodRow.running_balance_hash ?? null,
        anomaly_vector: anomalyVector,
        thresholds
      },
      rpt: rptRow
        ? {
            payload: rptPayload,
            payload_c14n: payloadC14n,
            payload_sha256: payloadSha,
            signature: rptRow.signature,
            created_at: asIsoString(rptRow.created_at)
          }
        : null,
      owa_ledger: ledgerEntries,
      owa_reconciled_totals: reconciledTotals,
      bas_labels: basLabels,
      bank_receipt_hash: ledgerSnapshot.lastReceipt ?? lastReceipt,
      anomaly_thresholds: thresholds,
      discrepancy_log: discrepancyLog
    };
  } finally {
    client.release();
  }
}
