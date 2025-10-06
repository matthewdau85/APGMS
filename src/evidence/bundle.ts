import { Pool } from "pg";
import {
  buildLabelResponse,
  coerceNumericRecord,
  basLabelMapping,
  type TaxType,
} from "../../apps/services/payments/src/bas/labels.js";
import { ensureBasTables } from "../../apps/services/payments/src/bas/storage.js";

const pool = new Pool();

type LabelView = Record<string, number | null>;

type CarryForward = {
  inbound: unknown;
  outbound: unknown;
};

function ensureLabelView(taxType: string, totals: Record<string, number>): LabelView {
  const map = basLabelMapping[taxType as TaxType];
  if (!map) return {};
  return buildLabelResponse(taxType as TaxType, totals);
}

function mapLedgerRows(rows: any[]) {
  return rows.map((row) => ({
    id: row.id,
    amount_cents: Number(row.amount_cents),
    balance_after_cents: Number(row.balance_after_cents),
    bank_receipt_hash: row.bank_receipt_hash ?? null,
    prev_hash: row.prev_hash ?? null,
    hash_after: row.hash_after ?? null,
    created_at: row.created_at,
  }));
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const client = await pool.connect();
  try {
    await ensureBasTables(pool);
    const periodRes = await client.query(
      `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    if (periodRes.rowCount === 0) {
      throw new Error("PERIOD_NOT_FOUND");
    }
    const periodRow = periodRes.rows[0];

    const rptRes = await client.query(
      `SELECT payload, payload_c14n, payload_sha256, signature, created_at
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
        ORDER BY id ASC`,
      [abn, taxType, periodId]
    );

    const basRes = await client.query(
      `SELECT label_totals, domain_totals, carry_forward_in, carry_forward_out
         FROM bas_period_totals
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    const basRow = basRes.rows[0];
    const labelTotals = coerceNumericRecord(basRow?.label_totals);
    const domainTotals = coerceNumericRecord(basRow?.domain_totals);
    const carryForward: CarryForward = {
      inbound: basRow?.carry_forward_in ?? null,
      outbound: basRow?.carry_forward_out ?? null,
    };

    const bundleRes = await client.query(
      `SELECT bundle_id FROM evidence_bundles WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );

    let amendments: Array<Record<string, unknown>> = [];
    if (bundleRes.rowCount) {
      const addendaRes = await client.query(
        `SELECT a.addendum, r.revision_seq
           FROM evidence_addenda a
           JOIN bas_revisions r ON r.revision_id = a.revision_id
          WHERE a.bundle_id = $1
          ORDER BY r.revision_seq ASC`,
        [bundleRes.rows[0].bundle_id]
      );
      amendments = addendaRes.rows.map((row) => ({
        revision_seq: row.revision_seq,
        ...(row.addendum ?? {}),
      }));
    }

    const result = {
      meta: {
        generated_at: new Date().toISOString(),
        abn,
        taxType,
        periodId,
      },
      period: {
        state: periodRow.state,
        accrued_cents: Number(periodRow.accrued_cents ?? 0),
        credited_to_owa_cents: Number(periodRow.credited_to_owa_cents ?? 0),
        final_liability_cents: Number(periodRow.final_liability_cents ?? 0),
        merkle_root: periodRow.merkle_root,
        running_balance_hash: periodRow.running_balance_hash,
        anomaly_vector: periodRow.anomaly_vector ?? {},
        thresholds: periodRow.thresholds ?? {},
      },
      rpt: rptRow
        ? {
            payload: rptRow.payload,
            payload_c14n: rptRow.payload_c14n ?? null,
            payload_sha256: rptRow.payload_sha256 ?? null,
            signature: rptRow.signature,
            created_at: rptRow.created_at,
          }
        : null,
      owa_ledger: mapLedgerRows(ledgerRes.rows),
      bas_labels: ensureLabelView(taxType, labelTotals),
      bas_domain_totals: domainTotals,
      carry_forward,
      amendments,
      discrepancy_log: [],
    };

    return result;
  } finally {
    client.release();
  }
}
