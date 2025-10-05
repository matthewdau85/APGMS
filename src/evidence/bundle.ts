import { Pool, PoolClient } from "pg";
import { sha256Hex } from "../crypto/merkle";

export interface EvidenceBundleOptions {
  pool?: QueryablePool;
  now?: Date;
}

type QueryablePool = Pick<Pool, "connect"> & { query: Pool["query"] };

type JsonRecord = Record<string, unknown>;

export interface BasLabelEvidence {
  ledger_total_cents: number | null;
  source_total_cents: number | null;
  variance_cents: number | null;
  final_value_cents: number | null;
  override: {
    value_cents: number;
    operator: string;
    reason: string;
    applied_at: string | null;
  } | null;
}

export type ReconDiscrepancyEntry = {
  type: "recon";
  bas_label: string;
  status: string;
  source_total_cents: number | null;
  ledger_total_cents: number | null;
  variance_cents: number | null;
  noted_at: string | null;
  note: string | null;
};

export type OverrideDiscrepancyEntry = {
  type: "override";
  bas_label: string;
  override_value_cents: number;
  reason: string;
  operator: string;
  applied_at: string | null;
};

export type DiscrepancyEntry = ReconDiscrepancyEntry | OverrideDiscrepancyEntry;

export interface EvidenceBundle {
  meta: {
    generated_at: string;
    abn: string;
    taxType: string;
    periodId: string;
    payload_sha256: string;
  };
  period: {
    state: string;
    accrued_cents: number;
    credited_to_owa_cents: number;
    final_liability_cents: number;
    merkle_root: string | null;
    running_balance_hash: string | null;
    anomaly_vector: JsonRecord;
    thresholds: JsonRecord;
  };
  rpt: {
    id: number;
    payload: JsonRecord;
    signature: string;
    created_at: string;
    payload_c14n: string | null;
    payload_sha256: string | null;
  } | null;
  owa_ledger: Array<{
    id: number;
    amount_cents: number;
    balance_after_cents: number;
    bank_receipt_hash: string | null;
    prev_hash: string | null;
    hash_after: string | null;
    created_at: string;
  }>;
  bas_labels: Record<string, BasLabelEvidence>;
  discrepancy_log: DiscrepancyEntry[];
  canonical_json: string;
}

const DEFAULT_LABELS = ["W1", "W2", "1A", "1B"];
const defaultPool = new Pool();

type BaseEvidenceBundle = {
  meta: {
    generated_at: string;
    abn: string;
    taxType: string;
    periodId: string;
  };
} & Omit<EvidenceBundle, "meta" | "canonical_json">;

export async function buildEvidenceBundle(
  abn: string,
  taxType: string,
  periodId: string,
  options: EvidenceBundleOptions = {}
): Promise<EvidenceBundle> {
  const pool = options.pool ?? defaultPool;
  const now = options.now ?? new Date();
  const client = await pool.connect();
  try {
    const periodRes = await client.query(
      "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId]
    );
    if (!periodRes.rowCount) {
      throw new Error("PERIOD_NOT_FOUND");
    }
    const periodRow = periodRes.rows[0];

    const rptRes = await client.query(
      `SELECT id, payload, payload_c14n, payload_sha256, signature, created_at
         FROM rpt_tokens
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    );
    const rptRow = rptRes.rows[0] ?? null;

    const ledgerRes = await client.query(
      `SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id`,
      [abn, taxType, periodId]
    );
    const ledger = ledgerRes.rows.map(row => ({
      id: Number(row.id),
      amount_cents: Number(row.amount_cents),
      balance_after_cents: Number(row.balance_after_cents),
      bank_receipt_hash: row.bank_receipt_hash ?? null,
      prev_hash: row.prev_hash ?? null,
      hash_after: row.hash_after ?? null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    }));

    const ledgerSummaries = await fetchLedgerSummaries(client, abn, taxType, periodId);
    const reconRows = await fetchReconRows(client, abn, taxType, periodId);
    const overrides = await fetchOverrides(client, abn, taxType, periodId);

    const { basLabels, discrepancyLog } = buildBasEvidence(ledgerSummaries, reconRows, overrides);

    const baseBundle: BaseEvidenceBundle = {
      meta: {
        generated_at: now.toISOString(),
        abn,
        taxType,
        periodId,
      },
      period: {
        state: periodRow.state,
        accrued_cents: Number(periodRow.accrued_cents ?? 0),
        credited_to_owa_cents: Number(periodRow.credited_to_owa_cents ?? 0),
        final_liability_cents: Number(periodRow.final_liability_cents ?? 0),
        merkle_root: periodRow.merkle_root ?? null,
        running_balance_hash: periodRow.running_balance_hash ?? null,
        anomaly_vector: (periodRow.anomaly_vector as JsonRecord) ?? {},
        thresholds: (periodRow.thresholds as JsonRecord) ?? {},
      },
      rpt: rptRow
        ? {
            id: Number(rptRow.id),
            payload: rptRow.payload as JsonRecord,
            signature: String(rptRow.signature),
            created_at: rptRow.created_at instanceof Date ? rptRow.created_at.toISOString() : rptRow.created_at,
            payload_c14n: rptRow.payload_c14n ?? null,
            payload_sha256: rptRow.payload_sha256 ?? null,
          }
        : null,
      owa_ledger: ledger,
      bas_labels: basLabels,
      discrepancy_log: discrepancyLog,
    };

    const canonical = canonicalJson(baseBundle);
    const payloadHash = sha256Hex(canonical);

    const finalBundle: EvidenceBundle = {
      ...baseBundle,
      meta: {
        ...baseBundle.meta,
        payload_sha256: payloadHash,
      },
      canonical_json: canonical,
    };

    await persistBundle(
      client,
      { abn, taxType, periodId },
      periodRow,
      rptRow,
      overrides,
      canonical,
      payloadHash,
      finalBundle
    );

    return finalBundle;
  } finally {
    client.release();
  }
}

function buildBasEvidence(
  ledgerSummaries: Map<string, number>,
  reconRows: ReconRow[],
  overrides: OverrideRow[]
): { basLabels: Record<string, BasLabelEvidence>; discrepancyLog: Array<JsonRecord> } {
  const labelOrder = new Map<string, number>();
  DEFAULT_LABELS.forEach((label, idx) => labelOrder.set(label, idx));
  const labels = new Set<string>(DEFAULT_LABELS);
  for (const key of ledgerSummaries.keys()) labels.add(key);
  for (const row of reconRows) labels.add(row.bas_label);
  for (const row of overrides) labels.add(row.bas_label);
  const ordered = Array.from(labels).sort((a, b) => {
    const ia = labelOrder.get(a);
    const ib = labelOrder.get(b);
    if (ia != null && ib != null) return ia - ib;
    if (ia != null) return -1;
    if (ib != null) return 1;
    return a.localeCompare(b);
  });

  const basLabels: Record<string, BasLabelEvidence> = {};
  for (const label of ordered) {
    const ledgerTotal = ledgerSummaries.has(label) ? ledgerSummaries.get(label)! : null;
    const reconForLabel = reconRows.filter(r => r.bas_label === label);
    const latestRecon = reconForLabel.length ? reconForLabel[reconForLabel.length - 1] : null;
    const overridesForLabel = overrides.filter(o => o.bas_label === label);
    const latestOverride = overridesForLabel.length ? overridesForLabel[overridesForLabel.length - 1] : null;

    const sourceTotal = latestRecon?.source_total_cents ?? null;
    const reconLedger = latestRecon?.ledger_total_cents ?? ledgerTotal;
    let variance = latestRecon?.variance_cents ?? null;
    if (variance == null && sourceTotal != null && reconLedger != null) {
      variance = sourceTotal - reconLedger;
    }

    const finalValue = latestOverride
      ? latestOverride.override_value_cents
      : reconLedger ?? ledgerTotal ?? null;

    basLabels[label] = {
      ledger_total_cents: ledgerTotal,
      source_total_cents: sourceTotal,
      variance_cents: variance,
      final_value_cents: finalValue,
      override: latestOverride
        ? {
            value_cents: latestOverride.override_value_cents,
            operator: latestOverride.operator_name,
            reason: latestOverride.reason,
            applied_at: latestOverride.applied_at ?? null,
          }
        : null,
    };
  }

  const discrepancyLog: DiscrepancyEntry[] = [];
  for (const row of reconRows) {
    discrepancyLog.push({
      type: "recon",
      bas_label: row.bas_label,
      status: row.status,
      source_total_cents: row.source_total_cents,
      ledger_total_cents: row.ledger_total_cents,
      variance_cents: row.variance_cents,
      noted_at: row.noted_at,
      note: row.note ?? null,
    });
  }
  for (const row of overrides) {
    discrepancyLog.push({
      type: "override",
      bas_label: row.bas_label,
      override_value_cents: row.override_value_cents,
      reason: row.reason,
      operator: row.operator_name,
      applied_at: row.applied_at,
    });
  }
  discrepancyLog.sort((a, b) => {
    const ta = a.type === "recon" ? a.noted_at : a.applied_at;
    const tb = b.type === "recon" ? b.noted_at : b.applied_at;
    return String(ta ?? "").localeCompare(String(tb ?? ""));
  });

  return { basLabels, discrepancyLog };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      out[k] = sortKeysDeep(v);
    }
    return out;
  }
  return value;
}

async function fetchLedgerSummaries(
  client: PoolClient,
  abn: string,
  taxType: string,
  periodId: string
): Promise<Map<string, number>> {
  if (!(await tableExists(client, "bas_ledger_movements"))) return new Map();
  const res = await client.query(
    `SELECT bas_label, SUM(amount_cents)::bigint AS ledger_total_cents
       FROM bas_ledger_movements
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      GROUP BY bas_label`,
    [abn, taxType, periodId]
  );
  const out = new Map<string, number>();
  for (const row of res.rows) {
    out.set(row.bas_label, Number(row.ledger_total_cents));
  }
  return out;
}

type ReconRow = {
  bas_label: string;
  source_total_cents: number | null;
  ledger_total_cents: number | null;
  variance_cents: number | null;
  status: string;
  noted_at: string | null;
  note: string | null;
};

async function fetchReconRows(
  client: PoolClient,
  abn: string,
  taxType: string,
  periodId: string
): Promise<ReconRow[]> {
  if (!(await tableExists(client, "bas_recon_results"))) return [];
  const res = await client.query(
    `SELECT bas_label,
            source_total_cents::bigint AS source_total_cents,
            ledger_total_cents::bigint AS ledger_total_cents,
            variance_cents::bigint AS variance_cents,
            status,
            noted_at,
            note
       FROM bas_recon_results
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY noted_at ASC, bas_label ASC`,
    [abn, taxType, periodId]
  );
  return res.rows.map(row => ({
    bas_label: row.bas_label,
    source_total_cents: row.source_total_cents == null ? null : Number(row.source_total_cents),
    ledger_total_cents: row.ledger_total_cents == null ? null : Number(row.ledger_total_cents),
    variance_cents: row.variance_cents == null ? null : Number(row.variance_cents),
    status: row.status,
    noted_at: row.noted_at instanceof Date ? row.noted_at.toISOString() : row.noted_at,
    note: row.note ?? null,
  }));
}

type OverrideRow = {
  bas_label: string;
  override_value_cents: number;
  reason: string;
  operator_name: string;
  applied_at: string | null;
};

async function fetchOverrides(
  client: PoolClient,
  abn: string,
  taxType: string,
  periodId: string
): Promise<OverrideRow[]> {
  if (!(await tableExists(client, "bas_operator_overrides"))) return [];
  const res = await client.query(
    `SELECT bas_label,
            override_value_cents::bigint AS override_value_cents,
            reason,
            operator_name,
            applied_at
       FROM bas_operator_overrides
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY applied_at ASC, bas_label ASC`,
    [abn, taxType, periodId]
  );
  return res.rows.map(row => ({
    bas_label: row.bas_label,
    override_value_cents: Number(row.override_value_cents),
    reason: row.reason,
    operator_name: row.operator_name,
    applied_at: row.applied_at instanceof Date ? row.applied_at.toISOString() : row.applied_at,
  }));
}

async function persistBundle(
  client: PoolClient,
  params: { abn: string; taxType: string; periodId: string },
  periodRow: any,
  rptRow: any,
  overrides: OverrideRow[],
  canonical: string,
  payloadHash: string,
  bundle: EvidenceBundle
) {
  if (!(await tableExists(client, "evidence_blobs"))) {
    // nothing to persist
  } else {
    const hashBuf = Buffer.from(payloadHash, "hex");
    const contentBuf = Buffer.from(canonical, "utf8");
    await client.query(
      `INSERT INTO evidence_blobs (payload_sha256, content)
       VALUES ($1, $2)
       ON CONFLICT (payload_sha256) DO NOTHING`,
      [hashBuf, contentBuf]
    );
  }

  if (await tableExists(client, "evidence_bundles")) {
    try {
      const columns = await getTableColumns(client, "evidence_bundles");
      const insertColumns = ["abn", "tax_type", "period_id", "payload_sha256"];
      const placeholders = ["$1", "$2", "$3", "$4"];
      const values: any[] = [params.abn, params.taxType, params.periodId, Buffer.from(payloadHash, "hex")];
      const updates = ["payload_sha256 = EXCLUDED.payload_sha256"];
      let idx = 5;

      if (columns.has("rpt_id") && rptRow?.id != null) {
        insertColumns.push("rpt_id");
        placeholders.push(`$${idx}`);
        values.push(Number(rptRow.id));
        updates.push("rpt_id = EXCLUDED.rpt_id");
        idx++;
      }
      if (columns.has("rpt_payload_json") && rptRow?.payload) {
        insertColumns.push("rpt_payload_json");
        placeholders.push(`$${idx}::jsonb`);
        values.push(JSON.stringify(rptRow.payload));
        updates.push("rpt_payload_json = EXCLUDED.rpt_payload_json");
        idx++;
      }
      if (columns.has("rpt_sig_ed25519") && rptRow?.signature) {
        const sigBuf = decodeBase64Safe(String(rptRow.signature));
        insertColumns.push("rpt_sig_ed25519");
        placeholders.push(`$${idx}`);
        values.push(sigBuf);
        updates.push("rpt_sig_ed25519 = EXCLUDED.rpt_sig_ed25519");
        idx++;
      } else if (columns.has("rpt_signature") && rptRow?.signature) {
        insertColumns.push("rpt_signature");
        placeholders.push(`$${idx}`);
        values.push(String(rptRow.signature));
        updates.push("rpt_signature = EXCLUDED.rpt_signature");
        idx++;
      }
      if (columns.has("rpt_payload_sha256") && rptRow?.payload_sha256) {
        insertColumns.push("rpt_payload_sha256");
        placeholders.push(`$${idx}`);
        values.push(decodeHexSafe(String(rptRow.payload_sha256)));
        updates.push("rpt_payload_sha256 = EXCLUDED.rpt_payload_sha256");
        idx++;
      }
      if (columns.has("anomaly_vector")) {
        insertColumns.push("anomaly_vector");
        placeholders.push(`$${idx}::jsonb`);
        values.push(JSON.stringify(periodRow?.anomaly_vector ?? {}));
        updates.push("anomaly_vector = EXCLUDED.anomaly_vector");
        idx++;
      }
      if (columns.has("thresholds")) {
        insertColumns.push("thresholds");
        placeholders.push(`$${idx}::jsonb`);
        values.push(JSON.stringify(periodRow?.thresholds ?? {}));
        updates.push("thresholds = EXCLUDED.thresholds");
        idx++;
      }
      if (columns.has("operator_overrides")) {
        insertColumns.push("operator_overrides");
        placeholders.push(`$${idx}::jsonb`);
        values.push(JSON.stringify(overrides));
        updates.push("operator_overrides = EXCLUDED.operator_overrides");
        idx++;
      }
      if (columns.has("bas_labels")) {
        insertColumns.push("bas_labels");
        placeholders.push(`$${idx}::jsonb`);
        values.push(JSON.stringify(bundle.bas_labels));
        updates.push("bas_labels = EXCLUDED.bas_labels");
        idx++;
      }
      if (columns.has("discrepancy_log")) {
        insertColumns.push("discrepancy_log");
        placeholders.push(`$${idx}::jsonb`);
        values.push(JSON.stringify(bundle.discrepancy_log));
        updates.push("discrepancy_log = EXCLUDED.discrepancy_log");
        idx++;
      }

      const sql = `INSERT INTO evidence_bundles (${insertColumns.join(", ")})
        VALUES (${placeholders.join(", ")})
        ON CONFLICT (abn, tax_type, period_id) DO UPDATE SET ${updates.join(", ")}`;
      await client.query(sql, values);
    } catch {
      // Best effort persistence; swallow to avoid breaking bundle generation if schema differs.
    }
  }
}

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [table]
  );
  return Boolean(res.rows[0]?.exists);
}

async function getTableColumns(client: PoolClient, table: string): Promise<Set<string>> {
  const res = await client.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set(res.rows.map(row => row.column_name));
}

function decodeBase64Safe(input: string): Buffer {
  try {
    return Buffer.from(input, "base64url");
  } catch {
    try {
      return Buffer.from(input, "base64");
    } catch {
      return Buffer.from(input, "utf8");
    }
  }
}

function decodeHexSafe(input: string): Buffer {
  try {
    return Buffer.from(input.replace(/^0x/, ""), "hex");
  } catch {
    return Buffer.from(input, "utf8");
  }
}
