import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit, PayToDebitParams } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool, PoolClient } from "pg";
import { v5 as uuidv5 } from "uuid";

const pool = new Pool();
const PAYTO_NAMESPACE = uuidv5("apgms-payto-ledger", uuidv5.URL);

const transferUuid = (txnId: string, kind: "deposit" | "reversal") =>
  uuidv5(`${txnId}:${kind}`, PAYTO_NAMESPACE);

type Severity = "INFO" | "WARN" | "ERROR";

type SettlementSummary = {
  ingested: number;
  posted: number;
  reversals: number;
  duplicates: number;
  discrepancies: number;
};

let ensureSettlementTablesPromise: Promise<void> | null = null;

async function ensureSettlementTables() {
  if (!ensureSettlementTablesPromise) {
    ensureSettlementTablesPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS split_settlement_receipts (
          id BIGSERIAL PRIMARY KEY,
          abn TEXT NOT NULL,
          tax_type TEXT NOT NULL,
          period_id TEXT NOT NULL,
          txn_id TEXT NOT NULL,
          gst_cents BIGINT NOT NULL,
          net_cents BIGINT NOT NULL,
          settlement_ts TIMESTAMPTZ NOT NULL,
          ledger_row_id BIGINT,
          reversed BOOLEAN NOT NULL DEFAULT false,
          reversal_gst_cents BIGINT,
          reversal_net_cents BIGINT,
          reversal_settlement_ts TIMESTAMPTZ,
          reversal_ledger_row_id BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (abn, tax_type, period_id, txn_id)
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS settlement_discrepancies (
          id BIGSERIAL PRIMARY KEY,
          abn TEXT NOT NULL,
          tax_type TEXT NOT NULL,
          period_id TEXT NOT NULL,
          txn_id TEXT,
          severity TEXT NOT NULL,
          message TEXT NOT NULL,
          observed JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS ix_settlement_discrepancies_period ON settlement_discrepancies(abn, tax_type, period_id)`
      );
    })();
  }
  return ensureSettlementTablesPromise;
}

async function recordDiscrepancy(
  client: PoolClient,
  summary: SettlementSummary,
  abn: string,
  taxType: string,
  periodId: string,
  txnId: string | null,
  severity: Severity,
  message: string,
  observed: any
) {
  summary.discrepancies += 1;
  await client.query(
    `INSERT INTO settlement_discrepancies(abn,tax_type,period_id,txn_id,severity,message,observed)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [abn, taxType, periodId, txnId, severity, message, observed ?? {}]
  );
}

function coerceCents(value: any, label: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${label} must be numeric`);
  }
  return Math.trunc(num);
}

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr =
    thresholds ||
    { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body;
  const pr = await pool.query(
    "select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: any, res: any) {
  try {
    const params: PayToDebitParams = {
      abn: req.body?.abn,
      mandateId: req.body?.mandateId,
      amountCents: coerceCents(req.body?.amount_cents, "amount_cents"),
      reference: req.body?.reference,
    };
    const r = await paytoDebit(params);
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function settlementWebhook(req: any, res: any) {
  const { abn, taxType, periodId, csv } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }
  const csvText = typeof csv === "string" ? csv : "";
  const rows = parseSettlementCSV(csvText);
  const summary: SettlementSummary = { ingested: rows.length, posted: 0, reversals: 0, duplicates: 0, discrepancies: 0 };
  await ensureSettlementTables();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const last = await client.query(
      `SELECT balance_after_cents FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [abn, taxType, periodId]
    );
    let balance = Number(last.rows[0]?.balance_after_cents ?? 0);

    for (const row of rows) {
      const txnId = String(row.txn_id || "").trim();
      if (!txnId) {
        await recordDiscrepancy(client, summary, abn, taxType, periodId, null, "ERROR", "Row missing txn_id", row);
        continue;
      }
      let gstCents: number;
      let netCents: number;
      try {
        gstCents = coerceCents(row.gst_cents, "gst_cents");
        netCents = coerceCents(row.net_cents, "net_cents");
      } catch (e: any) {
        await recordDiscrepancy(client, summary, abn, taxType, periodId, txnId, "ERROR", e.message, row);
        continue;
      }

      const existing = await client.query(
        `SELECT * FROM split_settlement_receipts
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND txn_id=$4
         FOR UPDATE`,
        [abn, taxType, periodId, txnId]
      );
      const receipt = existing.rows[0];

      if (gstCents >= 0) {
        if (receipt && receipt.ledger_row_id && !receipt.reversed) {
          summary.duplicates += 1;
          await recordDiscrepancy(
            client,
            summary,
            abn,
            taxType,
            periodId,
            txnId,
            "WARN",
            "Duplicate settlement row ignored",
            { incoming_gst_cents: gstCents, ledger_row_id: receipt.ledger_row_id }
          );
          continue;
        }

        const upsert = await client.query(
          `INSERT INTO split_settlement_receipts
             (abn,tax_type,period_id,txn_id,gst_cents,net_cents,settlement_ts,reversed)
           VALUES ($1,$2,$3,$4,$5,$6,$7,false)
           ON CONFLICT (abn,tax_type,period_id,txn_id)
           DO UPDATE SET
             gst_cents = EXCLUDED.gst_cents,
             net_cents = EXCLUDED.net_cents,
             settlement_ts = EXCLUDED.settlement_ts,
             reversed = false,
             reversal_gst_cents = NULL,
             reversal_net_cents = NULL,
             reversal_settlement_ts = NULL,
             reversal_ledger_row_id = NULL
           RETURNING id, ledger_row_id`,
          [abn, taxType, periodId, txnId, gstCents, netCents, row.settlement_ts]
        );
        const receiptId = upsert.rows[0].id;

        const uuid = transferUuid(txnId, "deposit");
        const insertLedger = await client.query(
          `INSERT INTO owa_ledger
             (abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (transfer_uuid) DO NOTHING
           RETURNING id,balance_after_cents`,
          [abn, taxType, periodId, uuid, gstCents, balance + gstCents, txnId, row.settlement_ts]
        );

        if (insertLedger.rowCount === 0) {
          const existingLedger = await client.query(
            `SELECT id,balance_after_cents FROM owa_ledger WHERE transfer_uuid=$1`,
            [uuid]
          );
          if (existingLedger.rowCount === 0) {
            await recordDiscrepancy(
              client,
              summary,
              abn,
              taxType,
              periodId,
              txnId,
              "ERROR",
              "Failed to persist settlement in owa_ledger",
              { gst_cents: gstCents }
            );
            continue;
          }
          summary.duplicates += 1;
          balance = Number(existingLedger.rows[0].balance_after_cents);
        } else {
          balance = Number(insertLedger.rows[0].balance_after_cents);
          summary.posted += 1;
          await client.query(
            `UPDATE split_settlement_receipts SET ledger_row_id=$1 WHERE id=$2`,
            [insertLedger.rows[0].id, receiptId]
          );
        }
      } else {
        if (!receipt || !receipt.ledger_row_id) {
          await recordDiscrepancy(
            client,
            summary,
            abn,
            taxType,
            periodId,
            txnId,
            "ERROR",
            "Reversal received before original settlement",
            { reversal_gst_cents: gstCents }
          );
          continue;
        }
        if (receipt.reversed) {
          summary.duplicates += 1;
          await recordDiscrepancy(
            client,
            summary,
            abn,
            taxType,
            periodId,
            txnId,
            "INFO",
            "Ignoring duplicate reversal notification",
            { reversal_gst_cents: gstCents }
          );
          continue;
        }
        const reversalAmount = Math.abs(gstCents);
        const uuid = transferUuid(txnId, "reversal");
        const insertLedger = await client.query(
          `INSERT INTO owa_ledger
             (abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id,balance_after_cents`,
          [abn, taxType, periodId, uuid, reversalAmount, balance + gstCents, `${txnId}:REVERSAL`, row.settlement_ts]
        );
        balance = Number(insertLedger.rows[0].balance_after_cents);
        summary.reversals += 1;
        await client.query(
          `UPDATE split_settlement_receipts
             SET reversed=true,
                 reversal_gst_cents=$1,
                 reversal_net_cents=$2,
                 reversal_settlement_ts=$3,
                 reversal_ledger_row_id=$4
           WHERE id=$5`,
          [reversalAmount, Math.abs(netCents), row.settlement_ts, insertLedger.rows[0].id, receipt.id]
        );
        await recordDiscrepancy(
          client,
          summary,
          abn,
          taxType,
          periodId,
          txnId,
          "WARN",
          "Settlement reversal applied",
          { reversal_gst_cents: reversalAmount, resulting_balance_cents: balance }
        );
      }
    }

    await client.query("COMMIT");
    return res.json(summary);
  } catch (e: any) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: e.message || String(e) });
  } finally {
    client.release();
  }
}

export async function evidence(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
