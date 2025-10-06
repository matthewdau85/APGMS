import { Pool, PoolClient } from "pg";

const pool = new Pool();

async function tableExists(client: PoolClient, tableName: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: string | null }>(
    "SELECT to_regclass($1) AS exists",
    [tableName]
  );
  return Boolean(rows[0]?.exists);
}

type SettlementSplit = {
  txn_id: string;
  gst_cents: number;
  net_cents: number;
  settlement_ts: string | null;
};

type SettlementMeta = {
  reference: string;
  amount_cents: number;
  channel: string;
  paid_at: string | null;
  ledger_id: number | null;
  transfer_uuid: string | null;
};

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const client = await pool.connect();
  try {
    const periodQ = await client.query(
      `SELECT state, accrued_cents, credited_to_owa_cents, final_liability_cents,
              merkle_root, running_balance_hash, anomaly_vector, thresholds
         FROM periods
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    const period = periodQ.rows[0];
    if (!period) {
      throw new Error("PERIOD_NOT_FOUND");
    }

    const rptQ = await client.query(
      `SELECT payload, payload_c14n, payload_sha256, signature, created_at
         FROM rpt_tokens
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    );
    const rpt = rptQ.rows[0] ?? null;

    const ledgerQ = await client.query(
      `SELECT id, transfer_uuid, amount_cents, balance_after_cents,
              bank_receipt_hash, prev_hash, hash_after, created_at
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id ASC`,
      [abn, taxType, periodId]
    );
    const ledger = ledgerQ.rows.map((row) => ({
      id: Number(row.id),
      transfer_uuid: row.transfer_uuid ?? null,
      amount_cents: Number(row.amount_cents),
      balance_after_cents: Number(row.balance_after_cents),
      bank_receipt_hash: row.bank_receipt_hash ?? null,
      prev_hash: row.prev_hash ?? null,
      hash_after: row.hash_after ?? null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    }));

    const ledgerBalance = ledger.reduce((sum, row) => sum + row.amount_cents, 0);
    const lastLedgerHash = ledger.length ? ledger[ledger.length - 1].hash_after : null;

    const hasSplits = await tableExists(client, "settlement_splits");
    let settlementSplits: SettlementSplit[] = [];
    if (hasSplits) {
      const splitQ = await client.query(
        `SELECT txn_id, gst_cents, net_cents, settlement_ts
           FROM settlement_splits
          WHERE abn=$1 AND tax_type=$2 AND period_id=$3
          ORDER BY settlement_ts NULLS LAST, txn_id`,
        [abn, taxType, periodId]
      );
      settlementSplits = splitQ.rows.map((row) => ({
        txn_id: String(row.txn_id),
        gst_cents: Number(row.gst_cents ?? 0),
        net_cents: Number(row.net_cents ?? 0),
        settlement_ts: row.settlement_ts instanceof Date ? row.settlement_ts.toISOString() : row.settlement_ts,
      }));
    }

    const hasSettlementMeta = await tableExists(client, "settlements");
    let settlements: SettlementMeta[] = [];
    if (hasSettlementMeta) {
      const settlementQ = await client.query(
        `SELECT s.reference, s.amount_cents, s.channel, s.paid_at,
                l.id AS ledger_id, l.transfer_uuid
           FROM settlements s
           LEFT JOIN owa_ledger l
             ON l.abn = s.abn AND l.tax_type = s.tax_type AND l.period_id = s.period_id
            AND l.amount_cents = -s.amount_cents
          WHERE s.abn=$1 AND s.tax_type=$2 AND s.period_id=$3
          ORDER BY s.paid_at DESC NULLS LAST, s.reference`,
        [abn, taxType, periodId]
      );
      settlements = settlementQ.rows.map((row) => ({
        reference: String(row.reference),
        amount_cents: Number(row.amount_cents ?? 0),
        channel: row.channel ?? "UNKNOWN",
        paid_at: row.paid_at instanceof Date ? row.paid_at.toISOString() : row.paid_at,
        ledger_id: row.ledger_id != null ? Number(row.ledger_id) : null,
        transfer_uuid: row.transfer_uuid ?? null,
      }));
    }

    const totalGst = settlementSplits.reduce((sum, row) => sum + row.gst_cents, 0);
    const totalNet = settlementSplits.reduce((sum, row) => sum + row.net_cents, 0);
    const settlementRemitted = settlements.reduce((sum, row) => sum + row.amount_cents, 0) || totalGst;
    const liability = Number(period.final_liability_cents ?? 0);

    const basLabels = {
      W1: settlementSplits.length ? totalNet : null,
      W2: null,
      "1A": settlementSplits.length ? totalGst : null,
      "1B": settlementSplits.length ? 0 : null,
    } as const;

    const discrepancyDeltas = [
      { key: "ledger_vs_period_liability", delta_cents: ledgerBalance - liability },
      { key: "settlement_vs_period_liability", delta_cents: settlementRemitted - liability },
      { key: "ledger_vs_settlement", delta_cents: ledgerBalance - settlementRemitted },
    ].filter((d) => Number.isFinite(d.delta_cents));

    return {
      meta: {
        generated_at: new Date().toISOString(),
        abn,
        taxType,
        periodId,
      },
      period: {
        state: period.state,
        accrued_cents: Number(period.accrued_cents ?? 0),
        credited_to_owa_cents: Number(period.credited_to_owa_cents ?? 0),
        final_liability_cents: liability,
        merkle_root: period.merkle_root ?? null,
        running_balance_hash: period.running_balance_hash ?? lastLedgerHash,
        anomaly_vector: period.anomaly_vector ?? {},
        thresholds: period.thresholds ?? {},
      },
      rpt: rpt
        ? {
            payload: rpt.payload ?? rpt.payload_c14n ?? null,
            payload_c14n: rpt.payload_c14n ?? null,
            payload_sha256: rpt.payload_sha256 ?? null,
            signature: rpt.signature ?? null,
            created_at: rpt.created_at instanceof Date ? rpt.created_at.toISOString() : rpt.created_at,
          }
        : null,
      owa_ledger: ledger,
      bas_labels: basLabels,
      discrepancy_deltas: discrepancyDeltas,
      discrepancy_log: discrepancyDeltas,
      settlements,
      settlement_splits: settlementSplits,
    };
  } finally {
    client.release();
  }
}
